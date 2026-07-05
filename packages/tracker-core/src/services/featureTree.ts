import {
  type BootstrapNodeInput,
  type BootstrapProjectMapInput,
  type FeatureNodeDto,
  type TreeVersionCause,
  type WorkUpdateSource,
} from '@vibetrack/shared';
import { type Db, type FeatureNode, type Prisma, type PrismaClient } from '../db.js';
import { buildFeatureTree } from '../dto.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { writeAudit } from './audit.js';
import { upsertEvidence } from './evidence.js';

export async function getFeatureNodes(db: Db, projectId: string): Promise<FeatureNode[]> {
  return db.featureNode.findMany({ where: { projectId } });
}

export async function getFeatureTree(db: Db, projectId: string): Promise<FeatureNodeDto[]> {
  return buildFeatureTree(await getFeatureNodes(db, projectId));
}

export async function requireFeature(
  db: Db,
  projectId: string,
  featureId: string,
): Promise<FeatureNode> {
  const node = await db.featureNode.findFirst({ where: { id: featureId, projectId } });
  if (!node) throw new NotFoundError('기능을 찾을 수 없습니다.');
  return node;
}

/** 트리 스냅샷 (FeatureTreeVersion.snapshot 에 저장되는 형태) */
export async function snapshotTree(db: Db, projectId: string): Promise<Prisma.InputJsonValue> {
  const nodes = await db.featureNode.findMany({
    where: { projectId },
    orderBy: [{ parentId: 'asc' }, { orderIndex: 'asc' }],
  });
  return nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    name: n.name,
    isCore: n.isCore,
    orderIndex: n.orderIndex,
    lifecycle: n.lifecycle,
    implementationStatus: n.implementationStatus,
    verificationStatus: n.verificationStatus,
  }));
}

export async function createTreeVersion(
  db: Db,
  params: {
    projectId: string;
    cause: TreeVersionCause;
    changeProposalId?: string;
    createdByUserId?: string;
  },
): Promise<{ id: string; version: number }> {
  const last = await db.featureTreeVersion.findFirst({
    where: { projectId: params.projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const snapshot = await snapshotTree(db, params.projectId);
  const created = await db.featureTreeVersion.create({
    data: {
      projectId: params.projectId,
      version: (last?.version ?? 0) + 1,
      cause: params.cause,
      snapshot,
      changeProposalId: params.changeProposalId ?? null,
      createdByUserId: params.createdByUserId ?? null,
    },
    select: { id: true, version: true },
  });
  return created;
}

/**
 * bootstrap_project_map: Claude Code가 만든 초기 기능 지도 초안을 등록한다.
 * - 무조건 DRAFT로 생성한다. 승인은 웹에서만 가능하다.
 * - ACTIVE 트리가 이미 있으면 거부한다 (구조 변경은 propose_structure_change로).
 * - DRAFT만 있으면 재부트스트랩으로 간주하고 기존 초안을 대체한다.
 */
export async function bootstrapProjectMap(
  prisma: PrismaClient,
  params: { input: BootstrapProjectMapInput; source?: WorkUpdateSource },
): Promise<{ tree: FeatureNodeDto[]; draftCount: number }> {
  const { input } = params;

  return prisma.$transaction(async (tx) => {
    const activeCount = await tx.featureNode.count({
      where: { projectId: input.projectId, lifecycle: 'ACTIVE' },
    });
    if (activeCount > 0) {
      throw new ConflictError(
        '이미 승인된 기능 트리가 있습니다. 구조 변경은 propose_structure_change 도구를 사용하세요.',
      );
    }

    // 재부트스트랩: 기존 초안 제거 (승인된 적 없는 데이터만 삭제된다)
    await tx.featureNode.deleteMany({ where: { projectId: input.projectId, lifecycle: 'DRAFT' } });
    await tx.inboxItem.updateMany({
      where: { projectId: input.projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
      data: { status: 'DISMISSED', resolvedAt: new Date(), resolutionNote: '재부트스트랩으로 대체됨' },
    });

    if (input.projectGoal) {
      await tx.project.update({
        where: { id: input.projectId },
        data: { goal: input.projectGoal },
      });
    }

    let draftCount = 0;
    const createNode = async (
      node: BootstrapNodeInput,
      parentId: string | null,
      orderIndex: number,
      depth: number,
    ): Promise<void> => {
      if (depth > 4) {
        throw new ValidationError('기능 트리는 4단계까지만 지원합니다.');
      }
      const created = await tx.featureNode.create({
        data: {
          projectId: input.projectId,
          parentId,
          name: node.name,
          description: node.description ?? null,
          isCore: node.isCore ?? false,
          orderIndex,
          lifecycle: 'DRAFT',
          implementationStatus: node.implementationStatus ?? 'NOT_STARTED',
          verificationStatus: 'UNKNOWN',
        },
      });
      draftCount += 1;

      const ev = node.evidence;
      if (ev) {
        const entries: { type: 'FILE' | 'ROUTE' | 'API_ENDPOINT' | 'TEST' | 'DOCUMENT'; values: string[] }[] = [
          { type: 'FILE', values: ev.files ?? [] },
          { type: 'ROUTE', values: ev.routes ?? [] },
          { type: 'API_ENDPOINT', values: ev.apiEndpoints ?? [] },
          { type: 'TEST', values: ev.tests ?? [] },
          { type: 'DOCUMENT', values: ev.documents ?? [] },
        ];
        for (const entry of entries) {
          for (const value of entry.values) {
            await upsertEvidence(tx, {
              projectId: input.projectId,
              featureNodeId: created.id,
              type: entry.type,
              path: value,
            });
          }
        }
      }

      for (const [i, child] of (node.children ?? []).entries()) {
        await createNode(child, created.id, i, depth + 1);
      }
    };

    for (const [i, root] of input.features.entries()) {
      await createNode(root, null, i, 1);
    }

    await tx.inboxItem.create({
      data: {
        projectId: input.projectId,
        type: 'FEATURE_MAP_REVIEW',
        title: `초기 기능 지도 검토 (기능 ${draftCount}개)`,
        detail: { draftCount, baseCommitSha: input.baseCommitSha ?? null },
      },
    });
    await writeAudit(tx, {
      projectId: input.projectId,
      action: 'feature_map.bootstrapped',
      detail: { draftCount, baseCommitSha: input.baseCommitSha ?? null },
    });

    return { tree: buildFeatureTree(await getFeatureNodes(tx, input.projectId)), draftCount };
  });
}

/** 초기 기능 지도 승인: DRAFT 전체 → ACTIVE + 트리 버전 기록 */
export async function approveInitialFeatureMap(
  prisma: PrismaClient,
  params: { projectId: string; userId: string },
): Promise<{ tree: FeatureNodeDto[]; version: number }> {
  return prisma.$transaction(async (tx) => {
    const draftCount = await tx.featureNode.count({
      where: { projectId: params.projectId, lifecycle: 'DRAFT' },
    });
    if (draftCount === 0) {
      throw new ConflictError('승인할 초안 기능 지도가 없습니다.');
    }
    await tx.featureNode.updateMany({
      where: { projectId: params.projectId, lifecycle: 'DRAFT' },
      data: { lifecycle: 'ACTIVE' },
    });
    const version = await createTreeVersion(tx, {
      projectId: params.projectId,
      cause: 'BOOTSTRAP_APPROVED',
      createdByUserId: params.userId,
    });
    await tx.inboxItem.updateMany({
      where: { projectId: params.projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByUserId: params.userId },
    });
    await writeAudit(tx, {
      projectId: params.projectId,
      userId: params.userId,
      action: 'feature_map.approved',
      detail: { approvedCount: draftCount, version: version.version },
    });
    return { tree: buildFeatureTree(await getFeatureNodes(tx, params.projectId)), version: version.version };
  });
}

/** 사용자가 웹에서 수동으로 기능을 추가하는 경우 (승인 절차 불필요 — 사용자 본인이 곧 승인자) */
export async function createFeatureManual(
  prisma: PrismaClient,
  params: {
    projectId: string;
    userId: string;
    name: string;
    description?: string;
    parentId?: string | null;
    isCore?: boolean;
  },
): Promise<FeatureNode> {
  return prisma.$transaction(async (tx) => {
    if (params.parentId) {
      await requireFeature(tx, params.projectId, params.parentId);
    }
    const siblingCount = await tx.featureNode.count({
      where: { projectId: params.projectId, parentId: params.parentId ?? null },
    });
    const node = await tx.featureNode.create({
      data: {
        projectId: params.projectId,
        parentId: params.parentId ?? null,
        name: params.name,
        description: params.description ?? null,
        isCore: params.isCore ?? false,
        orderIndex: siblingCount,
        lifecycle: 'ACTIVE',
      },
    });
    await createTreeVersion(tx, {
      projectId: params.projectId,
      cause: 'MANUAL_EDIT',
      createdByUserId: params.userId,
    });
    await writeAudit(tx, {
      projectId: params.projectId,
      userId: params.userId,
      action: 'feature.created_manually',
      entityType: 'FeatureNode',
      entityId: node.id,
    });
    return node;
  });
}

const manualImplementation = ['NOT_STARTED', 'PARTIAL', 'IMPLEMENTED', 'CHANGED'] as const;
const manualVerification = [
  'UNKNOWN',
  'NEEDS_VERIFICATION',
  'PASSED',
  'FAILED',
  'MANUAL_VERIFIED',
] as const;

/** 사용자가 웹에서 기능 메타데이터/상태를 수동으로 고치는 경우 */
export async function updateFeatureManual(
  prisma: PrismaClient,
  params: {
    projectId: string;
    userId: string;
    featureId: string;
    name?: string;
    description?: string | null;
    isCore?: boolean;
    implementationStatus?: (typeof manualImplementation)[number];
    verificationStatus?: (typeof manualVerification)[number];
    retire?: boolean;
  },
): Promise<FeatureNode> {
  return prisma.$transaction(async (tx) => {
    const node = await requireFeature(tx, params.projectId, params.featureId);
    const structural = params.retire === true || params.name !== undefined;
    const updated = await tx.featureNode.update({
      where: { id: node.id },
      data: {
        name: params.name ?? undefined,
        description: params.description === undefined ? undefined : params.description,
        isCore: params.isCore ?? undefined,
        implementationStatus: params.implementationStatus ?? undefined,
        verificationStatus: params.verificationStatus ?? undefined,
        ...(params.retire === true
          ? { lifecycle: 'RETIRED' as const, retiredAt: node.retiredAt ?? new Date() }
          : {}),
      },
    });
    if (structural) {
      await createTreeVersion(tx, {
        projectId: params.projectId,
        cause: 'MANUAL_EDIT',
        createdByUserId: params.userId,
      });
    }
    await writeAudit(tx, {
      projectId: params.projectId,
      userId: params.userId,
      action: params.retire ? 'feature.retired_manually' : 'feature.updated_manually',
      entityType: 'FeatureNode',
      entityId: node.id,
    });
    return updated;
  });
}
