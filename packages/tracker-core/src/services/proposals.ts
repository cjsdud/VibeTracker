import {
  type ProposedNode,
  type ProposeStructureChangeInput,
  type WorkUpdateSource,
} from '@vibetrack/shared';
import { type ChangeProposal, type Db, type FeatureNode, type PrismaClient } from '../db.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { writeAudit } from './audit.js';
import { createTreeVersion, requireFeature } from './featureTree.js';

function defaultTitle(input: ProposeStructureChangeInput, targetNames: string[]): string {
  const names = targetNames.join(', ');
  switch (input.type) {
    case 'CREATE':
      return `새 기능 제안: ${input.proposedNode?.name ?? ''}`;
    case 'RETIRE':
      return `기능 종료 제안: ${names}`;
    case 'RENAME':
      return `이름 변경 제안: ${names} → ${input.newName ?? ''}`;
    case 'MOVE':
      return `기능 이동 제안: ${names}`;
    case 'MERGE':
      return `기능 병합 제안: ${names}`;
    case 'SPLIT':
      return `기능 분리 제안: ${names}`;
    case 'REPLACE':
      return `기능 대체 제안: ${names} → ${input.proposedNode?.name ?? ''}`;
  }
}

/**
 * propose_structure_change: 기능 트리를 직접 수정하지 않는다.
 * 무조건 PENDING ChangeProposal + Inbox 항목을 만든다.
 */
export async function createProposal(
  prisma: PrismaClient,
  params: { input: ProposeStructureChangeInput; source?: WorkUpdateSource },
): Promise<ChangeProposal> {
  const { input } = params;
  return prisma.$transaction(async (tx) => {
    const targets: FeatureNode[] = [];
    for (const id of input.targetFeatureIds ?? []) {
      targets.push(await requireFeature(tx, input.projectId, id));
    }
    for (const target of targets) {
      if (target.lifecycle === 'RETIRED') {
        throw new ValidationError(`이미 종료된 기능입니다: ${target.name}`);
      }
    }
    if (input.mergeIntoFeatureId) {
      const into = await requireFeature(tx, input.projectId, input.mergeIntoFeatureId);
      if (into.lifecycle === 'RETIRED') {
        throw new ValidationError('이미 종료된 기능으로는 병합할 수 없습니다.');
      }
    }
    if (input.proposedNode?.parentFeatureId) {
      await requireFeature(tx, input.projectId, input.proposedNode.parentFeatureId);
    }
    for (const node of input.proposedNodes ?? []) {
      if (node.parentFeatureId) {
        await requireFeature(tx, input.projectId, node.parentFeatureId);
      }
    }
    if (input.newParentFeatureId) {
      await requireFeature(tx, input.projectId, input.newParentFeatureId);
    }

    const title =
      input.title ??
      defaultTitle(
        input,
        targets.map((t) => t.name),
      );
    const proposal = await tx.changeProposal.create({
      data: {
        projectId: input.projectId,
        type: input.type,
        title,
        reason: input.reason,
        targetFeatureIds: input.targetFeatureIds ?? [],
        payload: {
          proposedNode: input.proposedNode ?? null,
          proposedNodes: input.proposedNodes ?? null,
          newName: input.newName ?? null,
          newParentFeatureId: input.newParentFeatureId ?? null,
          mergeIntoFeatureId: input.mergeIntoFeatureId ?? null,
          retireSource: input.retireSource ?? null,
        },
        evidence: input.evidence ?? undefined,
        source: params.source ?? 'MCP',
      },
    });
    await tx.inboxItem.create({
      data: {
        projectId: input.projectId,
        type: 'STRUCTURE_PROPOSAL',
        title,
        changeProposalId: proposal.id,
        detail: { proposalType: input.type },
      },
    });
    await writeAudit(tx, {
      projectId: input.projectId,
      action: 'proposal.created',
      entityType: 'ChangeProposal',
      entityId: proposal.id,
      detail: { type: input.type },
    });
    return proposal;
  });
}

interface ProposalPayload {
  proposedNode: ProposedNode | null;
  proposedNodes: ProposedNode[] | null;
  newName: string | null;
  newParentFeatureId: string | null;
  mergeIntoFeatureId: string | null;
  retireSource: boolean | null;
}

/** candidateId가 nodeId 자신이거나 그 하위(자손)이면 거부한다 — 순환 방지의 단일 관문 */
async function assertNotDescendant(
  db: Db,
  projectId: string,
  nodeId: string,
  candidateParentId: string,
  message = '기능을 자기 자신의 하위로 이동할 수 없습니다.',
): Promise<void> {
  let current: string | null = candidateParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === nodeId) {
      throw new ValidationError(message);
    }
    if (seen.has(current)) break;
    seen.add(current);
    const parent: { parentId: string | null } | null = await db.featureNode.findFirst({
      where: { id: current, projectId },
      select: { parentId: true },
    });
    current = parent?.parentId ?? null;
  }
}

async function createNodeFromProposal(
  db: Db,
  projectId: string,
  node: ProposedNode,
  fallbackParentId: string | null,
): Promise<FeatureNode> {
  const parentId = node.parentFeatureId !== undefined ? node.parentFeatureId : fallbackParentId;
  // 승인 시점에 부모의 존재와 프로젝트 소속을 반드시 재검증한다 (교차 프로젝트/오타 방지)
  if (parentId) {
    await requireFeature(db, projectId, parentId);
  }
  const siblingCount = await db.featureNode.count({ where: { projectId, parentId } });
  return db.featureNode.create({
    data: {
      projectId,
      parentId,
      name: node.name,
      description: node.description ?? null,
      isCore: node.isCore ?? false,
      orderIndex: siblingCount,
      lifecycle: 'ACTIVE',
    },
  });
}

async function retireNode(db: Db, node: FeatureNode): Promise<void> {
  await db.featureNode.update({
    where: { id: node.id },
    data: { lifecycle: 'RETIRED', retiredAt: new Date() },
  });
}

/** 승인: 제안 타입별로 트리에 실제 적용하고 새 트리 버전을 만든다. */
export async function approveProposal(
  prisma: PrismaClient,
  params: { projectId: string; userId: string; proposalId: string },
): Promise<{ proposal: ChangeProposal; version: number }> {
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.changeProposal.findFirst({
      where: { id: params.proposalId, projectId: params.projectId },
    });
    if (!proposal) throw new NotFoundError('제안을 찾을 수 없습니다.');
    // 동시 승인(더블클릭/다중 탭) 방지: PENDING인 경우에만 원자적으로 선점한다.
    // 경쟁 트랜잭션은 행 잠금 대기 후 count 0을 받아 Conflict로 끝난다.
    const claimed = await tx.changeProposal.updateMany({
      where: { id: proposal.id, status: 'PENDING' },
      data: { status: 'APPROVED', decidedAt: new Date(), decidedByUserId: params.userId },
    });
    if (claimed.count !== 1) {
      throw new ConflictError('이미 처리된 제안입니다.');
    }
    const payload = proposal.payload as unknown as ProposalPayload;
    const targets: FeatureNode[] = [];
    for (const id of proposal.targetFeatureIds) {
      targets.push(await requireFeature(tx, params.projectId, id));
    }

    switch (proposal.type) {
      case 'CREATE': {
        if (!payload.proposedNode) throw new ValidationError('제안에 노드 정보가 없습니다.');
        await createNodeFromProposal(tx, params.projectId, payload.proposedNode, null);
        break;
      }
      case 'RETIRE': {
        for (const target of targets) await retireNode(tx, target);
        break;
      }
      case 'RENAME': {
        const target = targets[0];
        if (!target || !payload.newName) throw new ValidationError('이름 변경 정보가 없습니다.');
        await tx.featureNode.update({ where: { id: target.id }, data: { name: payload.newName } });
        break;
      }
      case 'MOVE': {
        const target = targets[0];
        if (!target) throw new ValidationError('이동 대상이 없습니다.');
        const newParentId = payload.newParentFeatureId;
        if (newParentId) {
          await requireFeature(tx, params.projectId, newParentId);
          await assertNotDescendant(tx, params.projectId, target.id, newParentId);
        }
        const siblingCount = await tx.featureNode.count({
          where: { projectId: params.projectId, parentId: newParentId ?? null },
        });
        await tx.featureNode.update({
          where: { id: target.id },
          data: { parentId: newParentId ?? null, orderIndex: siblingCount },
        });
        break;
      }
      case 'MERGE': {
        let into: FeatureNode;
        if (payload.mergeIntoFeatureId) {
          into = await requireFeature(tx, params.projectId, payload.mergeIntoFeatureId);
          if (into.lifecycle === 'RETIRED') {
            throw new ValidationError('이미 종료된 기능으로는 병합할 수 없습니다.');
          }
        } else if (payload.proposedNode) {
          into = await createNodeFromProposal(tx, params.projectId, payload.proposedNode, null);
        } else {
          throw new ValidationError('병합 대상 정보가 없습니다.');
        }
        // 병합 노드가 원본의 하위에 있으면 자식 이관 시 순환이 생겨 서브트리가 사라진다
        for (const source of targets) {
          if (source.id === into.id) continue;
          await assertNotDescendant(
            tx,
            params.projectId,
            source.id,
            into.id,
            '병합 대상 기능이 원본 기능의 하위에 있어 병합할 수 없습니다.',
          );
        }
        for (const source of targets) {
          if (source.id === into.id) continue;
          // 증거/자식/미해결 질문을 병합 노드로 이관하고 원본은 종료
          await tx.featureEvidence.updateMany({
            where: { featureNodeId: source.id },
            data: { featureNodeId: into.id },
          });
          await tx.featureNode.updateMany({
            where: { parentId: source.id },
            data: { parentId: into.id },
          });
          await tx.openQuestion.updateMany({
            where: { featureNodeId: source.id, status: 'OPEN' },
            data: { featureNodeId: into.id },
          });
          await retireNode(tx, source);
          await tx.featureRelation.create({
            data: {
              projectId: params.projectId,
              fromFeatureId: source.id,
              toFeatureId: into.id,
              type: 'MERGED_INTO',
              proposalId: proposal.id,
            },
          });
        }
        break;
      }
      case 'SPLIT': {
        const source = targets[0];
        if (!source || !payload.proposedNodes || payload.proposedNodes.length < 2) {
          throw new ValidationError('분리 정보가 없습니다.');
        }
        const retireSource = payload.retireSource ?? true;
        const fallbackParent = retireSource ? source.parentId : source.id;
        for (const node of payload.proposedNodes) {
          const created = await createNodeFromProposal(tx, params.projectId, node, fallbackParent);
          await tx.featureRelation.create({
            data: {
              projectId: params.projectId,
              fromFeatureId: created.id,
              toFeatureId: source.id,
              type: 'SPLIT_FROM',
              proposalId: proposal.id,
            },
          });
        }
        if (retireSource) {
          // 원본의 기존 자식이 종료된 부모 밑에 고립되지 않도록 한 단계 위로 올린다
          await tx.featureNode.updateMany({
            where: { parentId: source.id },
            data: { parentId: source.parentId },
          });
          await retireNode(tx, source);
        }
        break;
      }
      case 'REPLACE': {
        const target = targets[0];
        if (!target || !payload.proposedNode) throw new ValidationError('대체 정보가 없습니다.');
        // 새 노드의 부모가 대체 대상의 하위이면 자식 이관 시 순환이 생긴다
        if (payload.proposedNode.parentFeatureId) {
          await assertNotDescendant(
            tx,
            params.projectId,
            target.id,
            payload.proposedNode.parentFeatureId,
            '새 기능의 부모가 대체 대상 기능의 하위에 있어 대체할 수 없습니다.',
          );
        }
        const created = await createNodeFromProposal(
          tx,
          params.projectId,
          payload.proposedNode,
          target.parentId,
        );
        await tx.featureNode.updateMany({
          where: { parentId: target.id },
          data: { parentId: created.id },
        });
        await retireNode(tx, target);
        await tx.featureRelation.create({
          data: {
            projectId: params.projectId,
            fromFeatureId: target.id,
            toFeatureId: created.id,
            type: 'REPLACED_BY',
            proposalId: proposal.id,
          },
        });
        break;
      }
    }

    const version = await createTreeVersion(tx, {
      projectId: params.projectId,
      cause: 'PROPOSAL_APPLIED',
      changeProposalId: proposal.id,
      createdByUserId: params.userId,
    });
    const updated = await tx.changeProposal.update({
      where: { id: proposal.id },
      data: { appliedTreeVersionId: version.id },
    });
    await tx.inboxItem.updateMany({
      where: { changeProposalId: proposal.id, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByUserId: params.userId },
    });
    await writeAudit(tx, {
      projectId: params.projectId,
      userId: params.userId,
      action: 'proposal.approved',
      entityType: 'ChangeProposal',
      entityId: proposal.id,
      detail: { type: proposal.type, version: version.version },
    });
    return { proposal: updated, version: version.version };
  });
}

export async function rejectProposal(
  prisma: PrismaClient,
  params: { projectId: string; userId: string; proposalId: string; note?: string },
): Promise<ChangeProposal> {
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.changeProposal.findFirst({
      where: { id: params.proposalId, projectId: params.projectId },
    });
    if (!proposal) throw new NotFoundError('제안을 찾을 수 없습니다.');
    const claimed = await tx.changeProposal.updateMany({
      where: { id: proposal.id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: params.userId },
    });
    if (claimed.count !== 1) throw new ConflictError('이미 처리된 제안입니다.');
    const updated = await tx.changeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    await tx.inboxItem.updateMany({
      where: { changeProposalId: proposal.id, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedByUserId: params.userId,
        resolutionNote: params.note ?? '거절됨',
      },
    });
    await writeAudit(tx, {
      projectId: params.projectId,
      userId: params.userId,
      action: 'proposal.rejected',
      entityType: 'ChangeProposal',
      entityId: proposal.id,
    });
    return updated;
  });
}

/** 사용자가 승인 전에 제안 내용을 다듬는 경우 (PENDING 상태에서만) */
export async function editProposal(
  prisma: PrismaClient,
  params: {
    projectId: string;
    userId: string;
    proposalId: string;
    title?: string;
    reason?: string;
    payloadPatch?: Partial<ProposalPayload>;
  },
): Promise<ChangeProposal> {
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.changeProposal.findFirst({
      where: { id: params.proposalId, projectId: params.projectId },
    });
    if (!proposal) throw new NotFoundError('제안을 찾을 수 없습니다.');
    if (proposal.status !== 'PENDING')
      throw new ConflictError('이미 처리된 제안은 수정할 수 없습니다.');
    const payload = { ...(proposal.payload as object), ...(params.payloadPatch ?? {}) };
    const updated = await tx.changeProposal.update({
      where: { id: proposal.id },
      data: {
        title: params.title ?? undefined,
        reason: params.reason ?? undefined,
        payload,
      },
    });
    if (params.title) {
      await tx.inboxItem.updateMany({
        where: { changeProposalId: proposal.id, status: 'OPEN' },
        data: { title: params.title },
      });
    }
    await writeAudit(tx, {
      projectId: params.projectId,
      userId: params.userId,
      action: 'proposal.edited',
      entityType: 'ChangeProposal',
      entityId: proposal.id,
    });
    return updated;
  });
}
