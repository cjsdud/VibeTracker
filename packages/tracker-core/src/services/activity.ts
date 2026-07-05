import { type ActivityItemDto, type GithubEventDto } from '@vibetrack/shared';
import { type Db } from '../db.js';
import { toVerificationRunDto, toWorkUpdateDto } from '../dto.js';

function summarizeGithubEvent(event: {
  eventType: string;
  action: string | null;
  payload: unknown;
}): string {
  const payload = event.payload as Record<string, unknown> | null;
  if (event.eventType === 'push') {
    const commits = Array.isArray(payload?.commits) ? payload.commits.length : 0;
    const ref = typeof payload?.ref === 'string' ? payload.ref.replace('refs/heads/', '') : '';
    return `push: ${ref}에 커밋 ${commits}개`;
  }
  if (event.eventType === 'pull_request') {
    const pr = payload?.pull_request as { number?: number; title?: string } | undefined;
    return `PR #${pr?.number ?? '?'} ${event.action ?? ''}: ${pr?.title ?? ''}`;
  }
  if (event.eventType === 'check_run' || event.eventType === 'workflow_run') {
    const run = (payload?.check_run ?? payload?.workflow_run) as
      { name?: string; conclusion?: string } | undefined;
    return `${event.eventType}: ${run?.name ?? ''} → ${run?.conclusion ?? event.action ?? ''}`;
  }
  return `${event.eventType} ${event.action ?? ''}`.trim();
}

export async function listGithubEvents(
  db: Db,
  projectId: string,
  limit = 50,
): Promise<GithubEventDto[]> {
  const events = await db.githubEvent.findMany({
    where: { projectId },
    orderBy: { receivedAt: 'desc' },
    take: limit,
  });
  return events.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    action: e.action,
    summary: summarizeGithubEvent(e),
    receivedAt: e.receivedAt.toISOString(),
    status: e.status,
  }));
}

/** 활동 기록: 작업 기록 + GitHub 이벤트 + 검증 실행 + 승인 감사 로그를 시간순으로 합친다. */
export async function listActivity(
  db: Db,
  projectId: string,
  limit = 50,
): Promise<ActivityItemDto[]> {
  const [workUpdates, githubEvents, runs, audits] = await Promise.all([
    db.workUpdate.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { features: { include: { featureNode: { select: { id: true, name: true } } } } },
    }),
    listGithubEvents(db, projectId, limit),
    db.verificationRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { featureNode: { select: { name: true } } },
    }),
    db.auditLog.findMany({
      where: {
        projectId,
        action: {
          in: [
            'proposal.approved',
            'proposal.rejected',
            'feature_map.approved',
            'feature_map.bootstrapped',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const auditTitles: Record<string, string> = {
    'proposal.approved': '구조 변경 제안 승인',
    'proposal.rejected': '구조 변경 제안 거절',
    'feature_map.approved': '기능 지도 승인',
    'feature_map.bootstrapped': '초기 기능 지도 등록',
  };

  const items: ActivityItemDto[] = [
    ...workUpdates.map((w) => {
      const dto = toWorkUpdateDto(w);
      return {
        id: `wu_${w.id}`,
        kind: 'WORK_UPDATE' as const,
        title: dto.summary,
        detail:
          dto.featureNames.length > 0
            ? `기능: ${dto.featureNames.join(', ')}${dto.testsStatus ? ` · 테스트 ${dto.testsStatus}` : ''}`
            : '연결된 기능 없음',
        createdAt: dto.createdAt,
      };
    }),
    ...githubEvents.map((e) => ({
      id: `gh_${e.id}`,
      kind: 'GITHUB_EVENT' as const,
      title: e.summary,
      detail: null,
      createdAt: e.receivedAt,
    })),
    ...runs.map((r) => {
      const dto = toVerificationRunDto(r);
      return {
        id: `vr_${r.id}`,
        kind: 'VERIFICATION_RUN' as const,
        title: `${r.status === 'PASSED' ? '테스트 통과' : '테스트 실패'}: ${r.name ?? ''}`,
        detail: r.featureNode ? `기능: ${r.featureNode.name}` : (dto.commitSha ?? null),
        createdAt: dto.createdAt,
      };
    }),
    ...audits.map((a) => ({
      id: `au_${a.id}`,
      kind: 'AUDIT' as const,
      title: auditTitles[a.action] ?? a.action,
      detail: null,
      createdAt: a.createdAt.toISOString(),
    })),
  ];
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items.slice(0, limit);
}
