import {
  findFeaturesForFiles,
  upsertEvidence,
  type GithubEvent,
  type PrismaClient,
} from '@vibetrack/tracker-core';

interface PushCommit {
  id: string;
  message?: string;
  url?: string;
  added?: string[];
  modified?: string[];
  removed?: string[];
}

interface PushPayload {
  ref?: string;
  after?: string;
  commits?: PushCommit[];
}

interface PullRequestPayload {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    merged?: boolean;
    html_url?: string;
    head?: { sha?: string };
  };
}

interface CheckPayload {
  action?: string;
  check_run?: { name?: string; head_sha?: string; conclusion?: string; html_url?: string };
  workflow_run?: { name?: string; head_sha?: string; conclusion?: string; html_url?: string };
}

/**
 * GithubEvent 한 건을 처리한다. Job worker에서 호출된다.
 * 실패 시 throw → Job 재시도 (지수 backoff).
 */
export async function processGithubEvent(
  prisma: PrismaClient,
  githubEventId: string,
): Promise<void> {
  const event = await prisma.githubEvent.findUnique({ where: { id: githubEventId } });
  if (!event) return;
  if (event.status === 'PROCESSED' || event.status === 'SKIPPED') return; // 중복 처리 방지

  if (!event.projectId) {
    await prisma.githubEvent.update({
      where: { id: event.id },
      data: { status: 'SKIPPED', processedAt: new Date() },
    });
    return;
  }

  try {
    switch (event.eventType) {
      case 'push':
        await processPush(prisma, event, event.projectId);
        break;
      case 'pull_request':
        await processPullRequest(prisma, event, event.projectId);
        break;
      case 'check_run':
      case 'workflow_run':
        await processCheck(prisma, event, event.projectId);
        break;
      default:
        await prisma.githubEvent.update({
          where: { id: event.id },
          data: { status: 'SKIPPED', processedAt: new Date() },
        });
        return;
    }
    await prisma.githubEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    await prisma.githubEvent.update({
      where: { id: event.id },
      data: {
        status: 'FAILED',
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      },
    });
    throw error;
  }
}

async function processPush(
  prisma: PrismaClient,
  event: GithubEvent,
  projectId: string,
): Promise<void> {
  const payload = event.payload as PushPayload;
  const commits = payload.commits ?? [];
  if (commits.length === 0) return;

  const changedFiles = new Set<string>();
  const removedFiles = new Set<string>();
  const addedFiles = new Set<string>();
  for (const commit of commits) {
    for (const f of commit.added ?? []) {
      changedFiles.add(f);
      addedFiles.add(f);
    }
    for (const f of commit.modified ?? []) changedFiles.add(f);
    for (const f of commit.removed ?? []) removedFiles.add(f);
  }

  // 1) 변경 파일 ↔ 기능 증거 매칭
  const { matched, unmatchedFiles } = await findFeaturesForFiles(prisma, projectId, [
    ...changedFiles,
  ]);

  const now = new Date();
  for (const [featureNodeId, files] of matched) {
    const feature = await prisma.featureNode.findUnique({ where: { id: featureNodeId } });
    if (!feature || feature.lifecycle === 'RETIRED') continue;
    // 이 기능의 파일을 실제로 건드린 커밋만 증거로 연결한다
    for (const commit of commits) {
      const commitFiles = [...(commit.added ?? []), ...(commit.modified ?? [])];
      if (!commitFiles.some((f) => files.includes(f))) continue;
      await upsertEvidence(prisma, {
        projectId,
        featureNodeId,
        type: 'COMMIT',
        ref: commit.id,
        title: commit.message?.split('\n')[0]?.slice(0, 140) ?? null,
        url: commit.url ?? null,
        githubEventId: event.id,
      });
    }
    await prisma.featureNode.update({
      where: { id: featureNodeId },
      data: {
        implementationStatus: 'CHANGED',
        verificationStatus: 'NEEDS_VERIFICATION',
        lastChangedAt: now,
      },
    });
  }

  // 2) 어떤 기능과도 연결되지 않은 변경 → Inbox UNTRACKED_CHANGE
  if (unmatchedFiles.length > 0) {
    const branch = payload.ref?.replace('refs/heads/', '') ?? '';
    await prisma.inboxItem.create({
      data: {
        projectId,
        type: 'UNTRACKED_CHANGE',
        title: `추적되지 않은 변경 ${unmatchedFiles.length}개 파일 (${branch})`,
        githubEventId: event.id,
        detail: {
          changedFiles: unmatchedFiles.slice(0, 100),
          commitShas: commits.map((c) => c.id),
          branch,
        },
      },
    });
  }

  // 3) 파일 삭제/이름 변경: 기능을 삭제하지 않는다.
  //    같은 파일명이 새 경로로 추가됐으면 증거 경로만 갱신, 아니면 불일치 후보 생성.
  for (const removedPath of removedFiles) {
    const evidenceRows = await prisma.featureEvidence.findMany({
      where: { projectId, type: { in: ['FILE', 'TEST', 'DOCUMENT'] }, path: removedPath },
      include: { featureNode: { select: { id: true, name: true, lifecycle: true } } },
    });
    if (evidenceRows.length === 0) continue;
    const basename = removedPath.split('/').pop();
    const renamedTo = [...addedFiles].find((f) => f.split('/').pop() === basename);
    for (const row of evidenceRows) {
      if (renamedTo) {
        await prisma.featureEvidence.update({
          where: { id: row.id },
          data: { path: renamedTo, missing: false, metadata: { renamedFrom: removedPath } },
        });
      } else {
        await prisma.featureEvidence.update({
          where: { id: row.id },
          data: { missing: true },
        });
        if (row.featureNode.lifecycle !== 'RETIRED') {
          await prisma.inboxItem.create({
            data: {
              projectId,
              type: 'EVIDENCE_MISMATCH',
              title: `기능 "${row.featureNode.name}"의 증거 파일이 삭제됨: ${removedPath}`,
              githubEventId: event.id,
              featureNodeId: row.featureNode.id,
              detail: {
                kind: 'FILE_REMOVED',
                path: removedPath,
                hint: '기능이 제거된 것이라면 propose_structure_change(RETIRE)를 사용하세요.',
              },
            },
          });
        }
      }
    }
  }

  // 4) MCP 작업 기록과 GitHub 커밋 대조: 같은 SHA인데 변경 파일이 전혀 겹치지 않으면 불일치
  for (const commit of commits) {
    const workUpdates = await prisma.workUpdate.findMany({
      where: { projectId, gitHeadSha: commit.id, source: 'MCP' },
    });
    const commitFiles = [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ];
    for (const update of workUpdates) {
      const declared = Array.isArray(update.changedFiles) ? (update.changedFiles as string[]) : [];
      if (declared.length === 0 || commitFiles.length === 0) continue;
      const overlap = declared.some((f) => commitFiles.includes(f));
      if (!overlap) {
        await prisma.inboxItem.create({
          data: {
            projectId,
            type: 'EVIDENCE_MISMATCH',
            title: 'Claude Code 기록과 GitHub 커밋의 변경 파일이 일치하지 않습니다',
            githubEventId: event.id,
            workUpdateId: update.id,
            detail: {
              kind: 'WORK_UPDATE_MISMATCH',
              commitSha: commit.id,
              declaredFiles: declared.slice(0, 50),
              actualFiles: commitFiles.slice(0, 50),
            },
          },
        });
      }
    }
  }
}

async function processPullRequest(
  prisma: PrismaClient,
  event: GithubEvent,
  projectId: string,
): Promise<void> {
  const payload = event.payload as PullRequestPayload;
  const pr = payload.pull_request;
  if (!pr?.number) return;
  const headSha = pr.head?.sha;
  if (!headSha) return;

  // head SHA가 기록된 작업/커밋 증거를 통해 관련 기능을 찾는다
  const featureIds = new Set<string>();
  const workUpdates = await prisma.workUpdate.findMany({
    where: { projectId, gitHeadSha: headSha },
    include: { features: true },
  });
  for (const update of workUpdates) {
    for (const f of update.features) featureIds.add(f.featureNodeId);
  }
  const commitEvidence = await prisma.featureEvidence.findMany({
    where: { projectId, type: 'COMMIT', ref: headSha },
    select: { featureNodeId: true },
  });
  for (const row of commitEvidence) featureIds.add(row.featureNodeId);

  for (const featureNodeId of featureIds) {
    await upsertEvidence(prisma, {
      projectId,
      featureNodeId,
      type: 'PULL_REQUEST',
      ref: String(pr.number),
      title: pr.title?.slice(0, 140) ?? null,
      url: pr.html_url ?? null,
      githubEventId: event.id,
    });
  }
}

async function processCheck(
  prisma: PrismaClient,
  event: GithubEvent,
  projectId: string,
): Promise<void> {
  const payload = event.payload as CheckPayload;
  const run = payload.check_run ?? payload.workflow_run;
  if (!run?.head_sha) return;
  if (payload.action && payload.action !== 'completed') return;
  const conclusion = run.conclusion;
  if (conclusion !== 'success' && conclusion !== 'failure') return;
  const outcome = conclusion === 'success' ? ('PASSED' as const) : ('FAILED' as const);

  // commit SHA 기준으로 WorkUpdate와 기능을 찾는다
  const featureIds = new Set<string>();
  const workUpdates = await prisma.workUpdate.findMany({
    where: { projectId, gitHeadSha: run.head_sha },
    include: { features: true },
  });
  for (const update of workUpdates) {
    for (const f of update.features) featureIds.add(f.featureNodeId);
  }
  const commitEvidence = await prisma.featureEvidence.findMany({
    where: { projectId, type: 'COMMIT', ref: run.head_sha },
    select: { featureNodeId: true },
  });
  for (const row of commitEvidence) featureIds.add(row.featureNodeId);

  if (featureIds.size === 0) {
    // 기능과 연결할 수 없어도 검증 실행 기록은 남긴다
    await prisma.verificationRun.create({
      data: {
        projectId,
        commitSha: run.head_sha,
        source: 'CI',
        status: outcome,
        name: run.name ?? event.eventType,
        details: { url: run.html_url ?? null },
      },
    });
    return;
  }

  for (const featureNodeId of featureIds) {
    const feature = await prisma.featureNode.findUnique({ where: { id: featureNodeId } });
    if (!feature || feature.lifecycle === 'RETIRED') continue;
    await prisma.verificationRun.create({
      data: {
        projectId,
        featureNodeId,
        workUpdateId:
          workUpdates.find((w) => w.features.some((f) => f.featureNodeId === featureNodeId))?.id ??
          null,
        commitSha: run.head_sha,
        source: 'CI',
        status: outcome,
        name: run.name ?? event.eventType,
        details: { url: run.html_url ?? null },
      },
    });
    await prisma.featureNode.update({
      where: { id: featureNodeId },
      data: { verificationStatus: outcome },
    });
    if (outcome === 'FAILED') {
      await prisma.inboxItem.create({
        data: {
          projectId,
          type: 'TEST_FAILURE',
          title: `CI 실패: ${feature.name} (${run.name ?? event.eventType})`,
          githubEventId: event.id,
          featureNodeId,
          detail: { commitSha: run.head_sha, url: run.html_url ?? null },
        },
      });
    }
  }
}
