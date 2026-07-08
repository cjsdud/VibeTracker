import { type Db } from '../db.js';

/**
 * 기능별 "작업 중 변경"(브랜치 단위) 관리.
 *
 * 원칙:
 * - feature 브랜치의 커밋/MCP 기록은 여기에만 쌓이고 공식 상태(FeatureNode)를 바꾸지 않는다.
 * - PR이 기본 브랜치에 머지되는 시점에만 공식 상태로 승격된다.
 * - PR이 머지 없이 닫히거나 브랜치가 삭제되면 정리된다.
 */

type Source = 'GITHUB_WEBHOOK' | 'MCP_RECORD' | 'USER_MANUAL';

export async function upsertBranchActivity(
  db: Db,
  params: {
    projectId: string;
    featureNodeId: string;
    branch: string;
    source: Source;
    summary?: string | null;
    lastCommitSha?: string | null;
    prNumber?: number | null;
    prState?: string | null;
    ciFailed?: boolean;
  },
): Promise<void> {
  const update: Record<string, unknown> = { source: params.source };
  if (params.summary !== undefined && params.summary !== null) update.summary = params.summary;
  if (params.lastCommitSha !== undefined && params.lastCommitSha !== null)
    update.lastCommitSha = params.lastCommitSha;
  if (params.prNumber !== undefined && params.prNumber !== null) update.prNumber = params.prNumber;
  if (params.prState !== undefined && params.prState !== null) update.prState = params.prState;
  if (params.ciFailed !== undefined) update.ciFailed = params.ciFailed;

  await db.featureBranchActivity.upsert({
    where: {
      featureNodeId_branch: { featureNodeId: params.featureNodeId, branch: params.branch },
    },
    update,
    create: {
      projectId: params.projectId,
      featureNodeId: params.featureNodeId,
      branch: params.branch,
      source: params.source,
      summary: params.summary ?? null,
      lastCommitSha: params.lastCommitSha ?? null,
      prNumber: params.prNumber ?? null,
      prState: params.prState ?? null,
      ciFailed: params.ciFailed ?? false,
    },
  });
}

/**
 * PR 머지 시점: 브랜치의 작업 중 변경을 공식 상태로 승격하고 정리한다.
 * 공식 상태는 "구현됨/최근 변경됨 + 검증 필요"가 된다 — 코드는 main에 들어갔지만
 * main 기준 검증은 아직 없기 때문. 이후 main CI가 검증 상태를 갱신한다.
 * 멱등: 같은 브랜치에 대해 두 번 호출돼도(머지 push + PR 이벤트) 결과가 같다.
 */
export async function promoteBranchToOfficial(
  db: Db,
  params: { projectId: string; branch: string },
): Promise<{ promotedFeatureIds: string[] }> {
  const activities = await db.featureBranchActivity.findMany({
    where: { projectId: params.projectId, branch: params.branch },
    select: { featureNodeId: true },
  });
  const featureIds = [...new Set(activities.map((a) => a.featureNodeId))];
  const now = new Date();
  for (const featureNodeId of featureIds) {
    const feature = await db.featureNode.findUnique({ where: { id: featureNodeId } });
    if (!feature || feature.lifecycle === 'RETIRED') continue;
    await db.featureNode.update({
      where: { id: featureNodeId },
      data: {
        implementationStatus: feature.implementationStatus === 'NOT_STARTED' ? 'PARTIAL' : 'CHANGED',
        verificationStatus: 'NEEDS_VERIFICATION',
        lastStatusSource: 'GITHUB_WEBHOOK',
        lastChangedAt: now,
      },
    });
  }
  await db.featureBranchActivity.deleteMany({
    where: { projectId: params.projectId, branch: params.branch },
  });
  return { promotedFeatureIds: featureIds };
}

/** PR이 머지 없이 닫히거나 브랜치가 삭제된 경우: 작업 중 변경 정리 (승격 없음) */
export async function clearBranchActivities(
  db: Db,
  params: { projectId: string; branch: string },
): Promise<number> {
  const result = await db.featureBranchActivity.deleteMany({
    where: { projectId: params.projectId, branch: params.branch },
  });
  return result.count;
}

/** 기본 브랜치 push에 포함된 커밋이 어떤 브랜치 활동의 마지막 커밋이면(직접 머지 등) 정리한다 */
export async function clearBranchActivitiesByCommits(
  db: Db,
  params: { projectId: string; commitShas: string[] },
): Promise<number> {
  if (params.commitShas.length === 0) return 0;
  const result = await db.featureBranchActivity.deleteMany({
    where: { projectId: params.projectId, lastCommitSha: { in: params.commitShas } },
  });
  return result.count;
}

/** 브랜치 CI 결과 플래그 (공식 상태는 건드리지 않는다) */
export async function setBranchCiFailed(
  db: Db,
  params: { projectId: string; branch?: string; commitSha?: string; failed: boolean },
): Promise<number> {
  if (!params.branch && !params.commitSha) return 0;
  const result = await db.featureBranchActivity.updateMany({
    where: {
      projectId: params.projectId,
      ...(params.branch ? { branch: params.branch } : {}),
      ...(params.commitSha ? { lastCommitSha: params.commitSha } : {}),
    },
    data: { ciFailed: params.failed },
  });
  return result.count;
}
