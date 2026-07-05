import { type InboxItemDto } from '@vibetrack/shared';
import { type Db, type PrismaClient } from '../db.js';
import { toInboxItemDto } from '../dto.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { writeAudit } from './audit.js';
import { requireFeature } from './featureTree.js';
import { upsertEvidence } from './evidence.js';

export async function listInboxItems(
  db: Db,
  projectId: string,
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED' | 'ALL' = 'OPEN',
): Promise<InboxItemDto[]> {
  const items = await db.inboxItem.findMany({
    where: { projectId, ...(status === 'ALL' ? {} : { status }) },
    include: { changeProposal: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const result: InboxItemDto[] = [];
  for (const item of items) {
    let names: string[] = [];
    if (item.changeProposal && item.changeProposal.targetFeatureIds.length > 0) {
      const nodes = await db.featureNode.findMany({
        where: { id: { in: item.changeProposal.targetFeatureIds } },
        select: { name: true },
      });
      names = nodes.map((n) => n.name);
    }
    result.push(toInboxItemDto(item, names));
  }
  return result;
}

/** 구조 제안이 아닌 항목(추적 안 된 변경, 불일치, 테스트 실패)을 확인 완료/무시 처리 */
export async function resolveInboxItem(
  prisma: PrismaClient,
  params: {
    projectId: string;
    userId: string;
    inboxItemId: string;
    action: 'RESOLVED' | 'DISMISSED';
    note?: string;
  },
): Promise<void> {
  const item = await prisma.inboxItem.findFirst({
    where: { id: params.inboxItemId, projectId: params.projectId },
  });
  if (!item) throw new NotFoundError('Inbox 항목을 찾을 수 없습니다.');
  if (item.status !== 'OPEN') throw new ConflictError('이미 처리된 항목입니다.');
  if (item.type === 'STRUCTURE_PROPOSAL') {
    throw new ConflictError('구조 변경 제안은 승인 또는 거절로 처리하세요.');
  }
  if (item.type === 'FEATURE_MAP_REVIEW') {
    throw new ConflictError('기능 지도 검토는 기능 지도 화면에서 승인하세요.');
  }
  await prisma.inboxItem.update({
    where: { id: item.id },
    data: {
      status: params.action,
      resolvedAt: new Date(),
      resolvedByUserId: params.userId,
      resolutionNote: params.note ?? null,
    },
  });
  await writeAudit(prisma, {
    projectId: params.projectId,
    userId: params.userId,
    action: `inbox.${params.action.toLowerCase()}`,
    entityType: 'InboxItem',
    entityId: item.id,
  });
}

/** 추적되지 않은 변경을 기존 기능에 수동으로 연결한다. */
export async function linkUntrackedChangeToFeature(
  prisma: PrismaClient,
  params: { projectId: string; userId: string; inboxItemId: string; featureId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const item = await tx.inboxItem.findFirst({
      where: { id: params.inboxItemId, projectId: params.projectId },
    });
    if (!item) throw new NotFoundError('Inbox 항목을 찾을 수 없습니다.');
    if (item.type !== 'UNTRACKED_CHANGE') {
      throw new ConflictError('추적되지 않은 변경 항목만 기능에 연결할 수 있습니다.');
    }
    if (item.status !== 'OPEN') throw new ConflictError('이미 처리된 항목입니다.');
    const feature = await requireFeature(tx, params.projectId, params.featureId);

    const detail = (item.detail ?? {}) as {
      changedFiles?: string[];
      gitHeadSha?: string | null;
      commitShas?: string[];
    };
    for (const file of detail.changedFiles ?? []) {
      await upsertEvidence(tx, {
        projectId: params.projectId,
        featureNodeId: feature.id,
        type: 'FILE',
        path: file,
        githubEventId: item.githubEventId,
        workUpdateId: item.workUpdateId,
      });
    }
    const shas = [
      ...(detail.commitShas ?? []),
      ...(detail.gitHeadSha ? [detail.gitHeadSha] : []),
    ];
    for (const sha of shas) {
      await upsertEvidence(tx, {
        projectId: params.projectId,
        featureNodeId: feature.id,
        type: 'COMMIT',
        ref: sha,
        githubEventId: item.githubEventId,
        workUpdateId: item.workUpdateId,
      });
    }
    if (item.workUpdateId) {
      await tx.workUpdateFeature.upsert({
        where: {
          workUpdateId_featureNodeId: {
            workUpdateId: item.workUpdateId,
            featureNodeId: feature.id,
          },
        },
        update: {},
        create: { workUpdateId: item.workUpdateId, featureNodeId: feature.id },
      });
    }
    await tx.featureNode.update({
      where: { id: feature.id },
      data: {
        implementationStatus:
          feature.implementationStatus === 'NOT_STARTED' ? 'PARTIAL' : 'CHANGED',
        verificationStatus: 'NEEDS_VERIFICATION',
        lastChangedAt: new Date(),
      },
    });
    await tx.inboxItem.update({
      where: { id: item.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedByUserId: params.userId,
        resolutionNote: `기능 "${feature.name}"에 연결됨`,
        featureNodeId: feature.id,
      },
    });
    await writeAudit(tx, {
      projectId: params.projectId,
      userId: params.userId,
      action: 'inbox.linked_to_feature',
      entityType: 'InboxItem',
      entityId: item.id,
      detail: { featureId: feature.id },
    });
  });
}
