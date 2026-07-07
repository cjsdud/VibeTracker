import {
  assessFeatureMapQuality,
  type BootstrapNodeInput,
  type BootstrapProjectMapInput,
  type FeatureNodeDto,
  type MapQualityWarning,
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
 * bootstrap_project_map: Claude Code가 만든 기능 지도 초안을 등록한다.
 * - 무조건 DRAFT로 생성한다. 승인은 웹에서만 가능하다.
 * - 기존 DRAFT 초안이 있으면 새 초안으로 대체한다 (승인된 적 없는 데이터만 삭제).
 * - 승인된 ACTIVE 지도가 이미 있어도 등록할 수 있다(지도 교체 플로우):
 *   초안은 기존 지도와 나란히 존재하고, 사용자가 승인하는 시점에 기존 ACTIVE
 *   지도 전체가 RETIRED로 종료되며 초안이 새 지도가 된다. 승인 전까지는
 *   아무것도 바뀌지 않으므로 "구조 변경은 사용자 승인 필요" 원칙이 유지된다.
 */
export async function bootstrapProjectMap(
  prisma: PrismaClient,
  params: { input: BootstrapProjectMapInput; source?: WorkUpdateSource },
): Promise<{
  tree: FeatureNodeDto[];
  draftCount: number;
  replacesActiveMap: boolean;
  qualityWarnings: MapQualityWarning[];
}> {
  const { input } = params;
  // 규칙 기반 품질 점검 — 등록은 막지 않고 경고만 돌려준다.
  // Claude Code가 경고를 보고 고쳐서 재등록하면 초안이 교체된다.
  const qualityWarnings = assessFeatureMapQuality(input.features);

  return prisma.$transaction(async (tx) => {
    // 구조 변경 경로(부트스트랩/지도 승인/제안 승인)를 프로젝트 단위로 직렬화한다
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`;

    const activeCount = await tx.featureNode.count({
      where: { projectId: input.projectId, lifecycle: 'ACTIVE' },
    });
    const replacesActiveMap = activeCount > 0;

    // 재부트스트랩: 기존 초안 노드를 새 초안으로 교체한다.
    // 초안에 이미 붙은 사용자 데이터(미해결 질문, Inbox 항목, 작업 기록)는 잃지 않도록
    // 먼저 분리/재분류한 뒤 노드를 지운다.
    const drafts = await tx.featureNode.findMany({
      where: { projectId: input.projectId, lifecycle: 'DRAFT' },
      select: { id: true },
    });
    if (drafts.length > 0) {
      const draftIds = drafts.map((d) => d.id);
      await tx.openQuestion.updateMany({
        where: { featureNodeId: { in: draftIds } },
        data: { featureNodeId: null },
      });
      await tx.inboxItem.updateMany({
        where: { featureNodeId: { in: draftIds } },
        data: { featureNodeId: null },
      });
      // 초안에만 연결돼 있던 작업 기록은 링크가 사라지므로 추적되지 않은 작업으로 재분류한다
      const draftLinks = await tx.workUpdateFeature.findMany({
        where: { featureNodeId: { in: draftIds } },
        select: { workUpdateId: true },
      });
      for (const workUpdateId of new Set(draftLinks.map((l) => l.workUpdateId))) {
        const remaining = await tx.workUpdateFeature.count({
          where: { workUpdateId, featureNodeId: { notIn: draftIds } },
        });
        if (remaining > 0) continue;
        const existing = await tx.inboxItem.findFirst({
          where: { projectId: input.projectId, type: 'UNTRACKED_CHANGE', workUpdateId },
        });
        if (existing) continue;
        const update = await tx.workUpdate.findUniqueOrThrow({ where: { id: workUpdateId } });
        await tx.inboxItem.create({
          data: {
            projectId: input.projectId,
            type: 'UNTRACKED_CHANGE',
            title: `추적되지 않은 작업: ${update.summary.slice(0, 80)}`,
            workUpdateId,
            detail: { reason: '연결됐던 초안 기능이 재등록으로 교체됨' },
          },
        });
      }
      await tx.featureNode.deleteMany({ where: { id: { in: draftIds } } });
    }
    await tx.inboxItem.updateMany({
      where: { projectId: input.projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
      data: {
        status: 'DISMISSED',
        resolvedAt: new Date(),
        resolutionNote: '재부트스트랩으로 대체됨',
      },
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
        const entries: {
          type: 'FILE' | 'ROUTE' | 'API_ENDPOINT' | 'TEST' | 'DOCUMENT';
          values: string[];
        }[] = [
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
        title: replacesActiveMap
          ? `기능 지도 교체 검토 (기능 ${draftCount}개) — 승인하면 기존 지도는 종료됩니다`
          : `초기 기능 지도 검토 (기능 ${draftCount}개)`,
        detail: {
          draftCount,
          baseCommitSha: input.baseCommitSha ?? null,
          replacesActiveMap,
          // 웹 Inbox에서 사용자에게도 보여준다 (검토 시 판단 근거)
          qualityWarnings: qualityWarnings.slice(0, 15).map((w) => w.message),
          qualityWarningCount: qualityWarnings.length,
        },
      },
    });
    await writeAudit(tx, {
      projectId: input.projectId,
      action: 'feature_map.bootstrapped',
      detail: { draftCount, baseCommitSha: input.baseCommitSha ?? null, replacesActiveMap },
    });

    return {
      tree: buildFeatureTree(await getFeatureNodes(tx, input.projectId)),
      draftCount,
      replacesActiveMap,
      qualityWarnings,
    };
  });
}

/**
 * 기능 지도 승인: DRAFT 전체 → ACTIVE + 트리 버전 기록.
 * 기존 ACTIVE 지도가 있으면(지도 교체) 그 지도 전체를 RETIRED로 종료한다 —
 * 삭제가 아니므로 기존 작업 기록/증거/타임라인은 종료된 노드에 그대로 남는다.
 */
export async function approveInitialFeatureMap(
  prisma: PrismaClient,
  params: { projectId: string; userId: string },
): Promise<{ tree: FeatureNodeDto[]; version: number; retiredCount: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${params.projectId}, 0))`;

    const draftCount = await tx.featureNode.count({
      where: { projectId: params.projectId, lifecycle: 'DRAFT' },
    });
    if (draftCount === 0) {
      throw new ConflictError('승인할 초안 기능 지도가 없습니다.');
    }
    // 지도 교체: 이전 지도는 종료 처리 (기록 보존)
    const retired = await tx.featureNode.updateMany({
      where: { projectId: params.projectId, lifecycle: 'ACTIVE' },
      data: { lifecycle: 'RETIRED', retiredAt: new Date() },
    });
    await tx.featureNode.updateMany({
      where: { projectId: params.projectId, lifecycle: 'DRAFT' },
      data: { lifecycle: 'ACTIVE' },
    });
    // 옛 지도를 기준으로 만들어진 승인 대기 제안은 더 이상 적용할 수 없으므로 만료시킨다
    if (retired.count > 0) {
      const stale = await tx.changeProposal.findMany({
        where: { projectId: params.projectId, status: 'PENDING' },
        select: { id: true },
      });
      if (stale.length > 0) {
        const staleIds = stale.map((p) => p.id);
        await tx.changeProposal.updateMany({
          where: { id: { in: staleIds } },
          data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: params.userId },
        });
        await tx.inboxItem.updateMany({
          where: { changeProposalId: { in: staleIds }, status: 'OPEN' },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedByUserId: params.userId,
            resolutionNote: '기능 지도 교체로 만료됨',
          },
        });
      }
    }
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
      detail: { approvedCount: draftCount, retiredCount: retired.count, version: version.version },
    });
    return {
      tree: buildFeatureTree(await getFeatureNodes(tx, params.projectId)),
      version: version.version,
      retiredCount: retired.count,
    };
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

type ManualImplementation = 'NOT_STARTED' | 'PARTIAL' | 'IMPLEMENTED' | 'CHANGED';
type ManualVerification =
  'UNKNOWN' | 'NEEDS_VERIFICATION' | 'PASSED' | 'FAILED' | 'MANUAL_VERIFIED';

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
    implementationStatus?: ManualImplementation;
    verificationStatus?: ManualVerification;
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
