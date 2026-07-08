import { type BriefingDto, type BriefingRecentWorkItem } from '@vibetrack/shared';
import { type Db } from '../db.js';
import { needsVerificationWhere } from './predicates.js';

/**
 * 복귀 브리핑: 사용자가 오랜만에 프로젝트로 돌아왔을 때(또는 매 세션 시작 시)
 * Claude Code가 현재 상태를 이미 알고 시작하게 만드는 사실 요약.
 *
 * 원칙:
 * - GitHub 이벤트(커밋·PR·CI)가 1차 사실, MCP 작업 기록은 2차 맥락.
 *   MCP 기록이 하나도 없어도 커밋 기반으로 동작해야 한다.
 * - 추천/판단 문장을 만들지 않는다. "검증 필요 상태인 기능: X, Y"까지만.
 *   판단은 브리핑을 받은 에이전트가 세션 안에서 한다.
 */

interface PushEventPayload {
  ref?: string;
  commits?: { id: string; message?: string; timestamp?: string }[];
}

const dayMs = 24 * 60 * 60 * 1000;

function formatDate(iso: string | null): string {
  if (!iso) return '기록 없음';
  return iso.slice(0, 10);
}

export async function buildBriefing(db: Db, projectId: string): Promise<BriefingDto> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { repository: true },
  });
  const defaultBranch = project.repository?.defaultBranch ?? 'main';
  const now = new Date();

  // ---------- 1. 경과 시간 ----------
  const [lastWork, lastPushEvent, lastCommitEvidence] = await Promise.all([
    db.workUpdate.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    db.githubEvent.findFirst({
      where: { projectId, eventType: 'push' },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    }),
    db.featureEvidence.findFirst({
      where: { projectId, type: 'COMMIT' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  const lastCommitAt =
    [lastPushEvent?.receivedAt, lastCommitEvidence?.createdAt]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const lastActivityAt =
    [lastWork?.createdAt, lastCommitAt]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const daysSinceLastActivity = lastActivityAt
    ? Math.max(0, Math.floor((now.getTime() - lastActivityAt.getTime()) / dayMs))
    : null;

  // ---------- 2. 지난 작업 요약 (MCP 기록 → 커밋 폴백) ----------
  const workUpdates = await db.workUpdate.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { features: { include: { featureNode: { select: { name: true } } } } },
  });

  // 기본 브랜치 push 이벤트에서 커밋을 최신순으로 수집 (폴백 + 4번 섹션 공용)
  const pushEvents = await db.githubEvent.findMany({
    where: { projectId, eventType: 'push' },
    orderBy: { receivedAt: 'desc' },
    take: 50,
    select: { payload: true, receivedAt: true },
  });
  const defaultBranchCommits: { sha: string; message: string; at: Date }[] = [];
  const seenShas = new Set<string>();
  for (const event of pushEvents) {
    const payload = event.payload as PushEventPayload;
    if (payload.ref !== `refs/heads/${defaultBranch}`) continue;
    for (const commit of [...(payload.commits ?? [])].reverse()) {
      if (seenShas.has(commit.id)) continue;
      seenShas.add(commit.id);
      defaultBranchCommits.push({
        sha: commit.id,
        message: commit.message?.split('\n')[0]?.slice(0, 140) ?? '',
        at: commit.timestamp ? new Date(commit.timestamp) : event.receivedAt,
      });
    }
  }

  let recentWorkBasis: BriefingDto['recentWork']['basis'] = 'NONE';
  let recentWorkItems: BriefingRecentWorkItem[] = [];
  if (workUpdates.length > 0) {
    recentWorkBasis = 'WORK_RECORDS';
    recentWorkItems = workUpdates.map((w) => ({
      summary: w.summary,
      featureNames: w.features.map((f) => f.featureNode.name),
      testsStatus: (w.testsStatus as BriefingRecentWorkItem['testsStatus']) ?? null,
      occurredAt: w.createdAt.toISOString(),
      source: w.source,
    }));
  } else if (defaultBranchCommits.length > 0) {
    recentWorkBasis = 'COMMITS';
    recentWorkItems = defaultBranchCommits.slice(0, 5).map((c) => ({
      summary: c.message || c.sha.slice(0, 7),
      featureNames: [],
      testsStatus: null,
      occurredAt: c.at.toISOString(),
      source: 'GITHUB' as const,
    }));
  }

  // ---------- 3. 검증 필요 목록 ----------
  const needsVerification = await db.featureNode.findMany({
    where: { projectId, ...needsVerificationWhere },
    select: { id: true, name: true, isCore: true },
    orderBy: [{ isCore: 'desc' }, { lastChangedAt: 'desc' }],
    take: 20,
  });

  // ---------- 4. 최근 코드 변경 ----------
  // 관찰 창: 마지막 작업 기록 이후(=돌아온 사이), 기록이 없으면 최근 14일
  const windowStart = lastWork?.createdAt ?? new Date(now.getTime() - 14 * dayMs);
  const windowDays = Math.max(1, Math.ceil((now.getTime() - windowStart.getTime()) / dayMs));
  const defaultBranchCommitCount = defaultBranchCommits.filter((c) => c.at >= windowStart).length;

  const latestCiRun = await db.verificationRun.findFirst({
    where: { projectId, source: 'CI' },
    orderBy: { createdAt: 'desc' },
  });
  const branchActivities = await db.featureBranchActivity.findMany({
    where: { projectId },
    include: { featureNode: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  const byBranch = new Map<string, typeof branchActivities>();
  for (const activity of branchActivities) {
    const list = byBranch.get(activity.branch) ?? [];
    list.push(activity);
    byBranch.set(activity.branch, list);
  }
  const unmergedBranches = [...byBranch.entries()].map(([branch, activities]) => ({
    branch,
    featureNames: [...new Set(activities.map((a) => a.featureNode.name))],
    prNumber: activities.find((a) => a.prNumber !== null)?.prNumber ?? null,
    prState: activities.find((a) => a.prState !== null)?.prState ?? null,
    ciFailed: activities.some((a) => a.ciFailed),
    updatedAt: activities[0]!.updatedAt.toISOString(),
  }));

  // ---------- 5. 문제 있음 목록 ----------
  const brokenNodes = await db.featureNode.findMany({
    where: { projectId, lifecycle: 'ACTIVE', verificationStatus: 'FAILED' },
    select: { id: true, name: true, isCore: true },
    orderBy: [{ isCore: 'desc' }, { lastChangedAt: 'desc' }],
    take: 20,
  });
  const brokenQuestions = brokenNodes.length
    ? await db.openQuestion.findMany({
        where: {
          projectId,
          status: 'OPEN',
          featureNodeId: { in: brokenNodes.map((n) => n.id) },
        },
        select: { featureNodeId: true, question: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];
  const broken = brokenNodes.map((n) => ({
    ...n,
    openQuestions: brokenQuestions
      .filter((q) => q.featureNodeId === n.id)
      .slice(0, 3)
      .map((q) => q.question),
  }));

  const briefing: Omit<BriefingDto, 'briefingText'> = {
    project: { id: project.id, name: project.name, goal: project.goal },
    repository: project.repository
      ? { fullName: project.repository.fullName, defaultBranch }
      : null,
    generatedAt: now.toISOString(),
    elapsed: {
      lastWorkRecordAt: lastWork?.createdAt.toISOString() ?? null,
      lastCommitAt: lastCommitAt?.toISOString() ?? null,
      daysSinceLastActivity,
    },
    recentWork: { basis: recentWorkBasis, items: recentWorkItems },
    needsVerification,
    recentCodeChanges: {
      windowDays,
      defaultBranchCommitCount,
      latestCi: latestCiRun
        ? {
            status: latestCiRun.status,
            name: latestCiRun.name,
            at: latestCiRun.createdAt.toISOString(),
          }
        : null,
      unmergedBranches,
    },
    broken,
  };

  return { ...briefing, briefingText: renderBriefingText(briefing) };
}

/** 사람이 읽는 브리핑 텍스트 — 사실 나열만, 추천 문장 없음 */
export function renderBriefingText(b: Omit<BriefingDto, 'briefingText'>): string {
  const lines: string[] = [];
  lines.push(`[VibeTrack 복귀 브리핑] ${b.project.name}`);
  if (b.project.goal) lines.push(`목표: ${b.project.goal}`);

  if (b.elapsed.daysSinceLastActivity === null) {
    lines.push('경과: 아직 기록된 활동이 없습니다.');
  } else if (b.elapsed.daysSinceLastActivity === 0) {
    lines.push('경과: 마지막 활동은 오늘입니다.');
  } else {
    lines.push(
      `경과: 마지막 활동 이후 ${b.elapsed.daysSinceLastActivity}일 지남 ` +
        `(마지막 작업 기록 ${formatDate(b.elapsed.lastWorkRecordAt)}, 마지막 커밋 ${formatDate(b.elapsed.lastCommitAt)})`,
    );
  }

  lines.push('');
  if (b.recentWork.items.length === 0) {
    lines.push('지난 작업: 기록 없음');
  } else {
    lines.push(
      b.recentWork.basis === 'COMMITS' ? '지난 작업 (커밋 메시지 기반):' : '지난 작업:',
    );
    for (const item of b.recentWork.items) {
      const feats = item.featureNames.length ? ` [${item.featureNames.join(', ')}]` : '';
      const tests =
        item.testsStatus === 'PASSED'
          ? ' (테스트 통과)'
          : item.testsStatus === 'FAILED'
            ? ' (테스트 실패)'
            : '';
      lines.push(`- ${formatDate(item.occurredAt)} ${item.summary}${feats}${tests}`);
    }
  }

  lines.push('');
  if (b.needsVerification.length === 0) {
    lines.push('검증 필요 상태인 기능: 없음');
  } else {
    lines.push(
      `검증 필요 상태인 기능 ${b.needsVerification.length}개: ` +
        b.needsVerification.map((f) => f.name + (f.isCore ? '(핵심)' : '')).join(', '),
    );
  }

  lines.push('');
  lines.push('최근 코드 변경:');
  const branchName = b.repository?.defaultBranch ?? 'main';
  lines.push(
    `- 최근 ${b.recentCodeChanges.windowDays}일간 ${branchName} 반영 커밋 ${b.recentCodeChanges.defaultBranchCommitCount}개`,
  );
  if (b.recentCodeChanges.latestCi) {
    lines.push(
      `- 최근 CI: ${b.recentCodeChanges.latestCi.status === 'PASSED' ? '통과' : '실패'}` +
        (b.recentCodeChanges.latestCi.name ? ` (${b.recentCodeChanges.latestCi.name})` : '') +
        ` — ${formatDate(b.recentCodeChanges.latestCi.at)}`,
    );
  } else {
    lines.push('- CI 기록 없음');
  }
  if (b.recentCodeChanges.unmergedBranches.length === 0) {
    lines.push(`- ${branchName} 미반영 브랜치: 없음`);
  } else {
    for (const branch of b.recentCodeChanges.unmergedBranches) {
      const pr = branch.prNumber ? `, PR #${branch.prNumber} ${branch.prState ?? ''}`.trim() : '';
      const ci = branch.ciFailed ? ', CI 실패' : '';
      lines.push(
        `- ${branchName} 미반영: ${branch.branch} (기능: ${branch.featureNames.join(', ') || '미상'}${pr}${ci})`,
      );
    }
  }

  lines.push('');
  if (b.broken.length === 0) {
    lines.push('문제 있음 상태인 기능: 없음');
  } else {
    lines.push(`문제 있음 상태인 기능 ${b.broken.length}개:`);
    for (const feature of b.broken) {
      lines.push(`- ${feature.name}${feature.isCore ? '(핵심)' : ''}`);
      for (const q of feature.openQuestions) lines.push(`  · 미해결: ${q}`);
    }
  }

  return lines.join('\n');
}
