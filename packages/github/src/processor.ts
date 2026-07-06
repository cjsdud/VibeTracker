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
 * Job 재시도 시 부분 처리된 이벤트가 다시 돌아도 Inbox 항목이 중복 생성되지 않도록
 * (githubEventId, type, featureNodeId, workUpdateId) 기준으로 한 번만 만든다.
 */
async function createInboxItemOnce(
  prisma: PrismaClient,
  data: {
    projectId: string;
    type: 'UNTRACKED_CHANGE' | 'EVIDENCE_MISMATCH' | 'TEST_FAILURE';
    title: string;
    githubEventId: string;
    featureNodeId?: string | null;
    workUpdateId?: string | null;
    detail?: object;
  },
): Promise<void> {
  const existing = await prisma.inboxItem.findFirst({
    where: {
      projectId: data.projectId,
      type: data.type,
      githubEventId: data.githubEventId,
      featureNodeId: data.featureNodeId ?? null,
      workUpdateId: data.workUpdateId ?? null,
    },
  });
  if (existing) return;
  await prisma.inboxItem.create({
    data: {
      projectId: data.projectId,
      type: data.type,
      title: data.title,
      githubEventId: data.githubEventId,
      featureNodeId: data.featureNodeId ?? null,
      workUpdateId: data.workUpdateId ?? null,
      detail: data.detail,
    },
  });
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
  const commitShas = commits.map((c) => c.id);
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
    // 이 push가 부분 실패 후 재시도되는 사이 같은 커밋의 CI 결과가 이미 반영됐다면
    // 그 최신 검증 상태를 NEEDS_VERIFICATION으로 되돌리지 않는다
    const newerRun = await prisma.verificationRun.findFirst({
      where: {
        projectId,
        featureNodeId,
        commitSha: { in: commitShas },
        createdAt: { gt: event.receivedAt },
      },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.featureNode.update({
      where: { id: featureNodeId },
      data: {
        implementationStatus: 'CHANGED',
        verificationStatus: newerRun ? newerRun.status : 'NEEDS_VERIFICATION',
        lastChangedAt: now,
      },
    });
  }

  // 2) 어떤 기능과도 연결되지 않은 변경 → Inbox UNTRACKED_CHANGE
  if (unmatchedFiles.length > 0) {
    const branch = payload.ref?.replace('refs/heads/', '') ?? '';
    await createInboxItemOnce(prisma, {
      projectId,
      type: 'UNTRACKED_CHANGE',
      title: `추적되지 않은 변경 ${unmatchedFiles.length}개 파일 (${branch})`,
      githubEventId: event.id,
      detail: {
        changedFiles: unmatchedFiles.slice(0, 100),
        commitShas: commits.map((c) => c.id),
        branch,
      },
    });
  }

  // 3) 파일 삭제/이름 변경: 기능을 삭제하지 않는다.
  //    이름 변경으로 확신할 수 있을 때만(유일 후보 + 흔한 파일명 제외) 증거 경로를 갱신하고,
  //    아니면 missing 표시 후 기능별로 모아 불일치 후보(구조 변경 후보) 하나를 만든다.
  const COMMON_BASENAMES = new Set([
    'index.ts',
    'index.tsx',
    'index.js',
    'index.jsx',
    'index.html',
    'readme.md',
    '__init__.py',
    'mod.rs',
    'main.py',
    'main.go',
    'package.json',
  ]);
  const removedByFeature = new Map<string, { name: string; paths: string[] }>();
  for (const removedPath of removedFiles) {
    const evidenceRows = await prisma.featureEvidence.findMany({
      where: { projectId, type: { in: ['FILE', 'TEST', 'DOCUMENT'] }, path: removedPath },
      include: { featureNode: { select: { id: true, name: true, lifecycle: true } } },
    });
    if (evidenceRows.length === 0) continue;
    const basename = removedPath.split('/').pop() ?? '';
    const candidates = [...addedFiles].filter((f) => f.split('/').pop() === basename);
    const renamedTo =
      candidates.length === 1 && !COMMON_BASENAMES.has(basename.toLowerCase())
        ? candidates[0]
        : undefined;
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
          const entry = removedByFeature.get(row.featureNode.id) ?? {
            name: row.featureNode.name,
            paths: [],
          };
          if (!entry.paths.includes(removedPath)) entry.paths.push(removedPath);
          removedByFeature.set(row.featureNode.id, entry);
        }
      }
    }
  }
  for (const [featureNodeId, entry] of removedByFeature) {
    await createInboxItemOnce(prisma, {
      projectId,
      type: 'EVIDENCE_MISMATCH',
      title:
        entry.paths.length === 1
          ? `기능 "${entry.name}"의 증거 파일이 삭제됨: ${entry.paths[0]}`
          : `기능 "${entry.name}"의 증거 파일 ${entry.paths.length}개가 삭제됨`,
      githubEventId: event.id,
      featureNodeId,
      detail: {
        kind: 'FILE_REMOVED',
        paths: entry.paths.slice(0, 50),
        hint: '기능이 제거된 것이라면 propose_structure_change(RETIRE)를 사용하세요.',
      },
    });
  }

  // 4) MCP 작업 기록과 GitHub 커밋 대조.
  //    gitHeadSha는 "작업 종료 시점 HEAD"라 한 세션이 여러 커밋을 만들 수 있으므로,
  //    HEAD 커밋 하나가 아니라 이 push 전체의 변경 파일 합집합과 비교해 오탐을 줄인다.
  const allPushFiles = new Set<string>([...changedFiles, ...removedFiles]);
  for (const commit of commits) {
    const workUpdates = await prisma.workUpdate.findMany({
      where: { projectId, gitHeadSha: commit.id, source: 'MCP' },
    });
    for (const update of workUpdates) {
      const declared = Array.isArray(update.changedFiles) ? (update.changedFiles as string[]) : [];
      if (declared.length === 0 || allPushFiles.size === 0) continue;
      const overlap = declared.some((f) => allPushFiles.has(f));
      if (!overlap) {
        await createInboxItemOnce(prisma, {
          projectId,
          type: 'EVIDENCE_MISMATCH',
          title: 'Claude Code 기록과 GitHub 커밋의 변경 파일이 일치하지 않습니다',
          githubEventId: event.id,
          workUpdateId: update.id,
          detail: {
            kind: 'WORK_UPDATE_MISMATCH',
            commitSha: commit.id,
            declaredFiles: declared.slice(0, 50),
            actualFiles: [...allPushFiles].slice(0, 50),
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

  // Job 재시도 시 같은 이벤트가 검증 기록을 중복 생성하지 않도록 한다
  const runName = run.name ?? event.eventType;
  const createRunOnce = async (featureNodeId: string | null, workUpdateId: string | null) => {
    const existing = await prisma.verificationRun.findFirst({
      where: {
        projectId,
        featureNodeId,
        commitSha: run.head_sha ?? null,
        source: 'CI',
        name: runName,
        status: outcome,
      },
    });
    if (existing) return;
    await prisma.verificationRun.create({
      data: {
        projectId,
        featureNodeId,
        workUpdateId,
        commitSha: run.head_sha ?? null,
        source: 'CI',
        status: outcome,
        name: runName,
        details: { url: run.html_url ?? null },
      },
    });
  };

  if (featureIds.size === 0) {
    // 기능과 연결할 수 없어도 검증 실행 기록은 남긴다
    await createRunOnce(null, null);
    return;
  }

  for (const featureNodeId of featureIds) {
    const feature = await prisma.featureNode.findUnique({ where: { id: featureNodeId } });
    if (!feature || feature.lifecycle === 'RETIRED') continue;
    await createRunOnce(
      featureNodeId,
      workUpdates.find((w) => w.features.some((f) => f.featureNodeId === featureNodeId))?.id ??
        null,
    );
    await prisma.featureNode.update({
      where: { id: featureNodeId },
      data: { verificationStatus: outcome },
    });
    if (outcome === 'FAILED') {
      await createInboxItemOnce(prisma, {
        projectId,
        type: 'TEST_FAILURE',
        title: `CI 실패: ${feature.name} (${run.name ?? event.eventType})`,
        githubEventId: event.id,
        featureNodeId,
        detail: { commitSha: run.head_sha, url: run.html_url ?? null },
      });
    }
  }
}
