import {
  deriveDisplayStatus,
  type ChangeProposalDto,
  type FeatureEvidenceDto,
  type FeatureNodeDto,
  type InboxItemDto,
  type OpenQuestionDto,
  type VerificationRunDto,
  type WorkUpdateDto,
} from '@vibetrack/shared';
import {
  type ChangeProposal,
  type FeatureEvidence,
  type FeatureNode,
  type InboxItem,
  type OpenQuestion,
  type VerificationRun,
  type WorkUpdate,
  type WorkUpdateFeature,
} from './db.js';

export function toFeatureNodeDto(
  node: FeatureNode,
  children: FeatureNodeDto[] = [],
): FeatureNodeDto {
  return {
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    description: node.description,
    isCore: node.isCore,
    orderIndex: node.orderIndex,
    lifecycle: node.lifecycle,
    implementationStatus: node.implementationStatus,
    verificationStatus: node.verificationStatus,
    displayStatus: deriveDisplayStatus(node),
    lastChangedAt: node.lastChangedAt?.toISOString() ?? null,
    children,
  };
}

/** 평면 노드 목록을 orderIndex 순서의 트리로 조립한다. */
export function buildFeatureTree(nodes: FeatureNode[]): FeatureNodeDto[] {
  const byParent = new Map<string | null, FeatureNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }
  const build = (parentId: string | null): FeatureNodeDto[] => {
    const children = byParent.get(parentId) ?? [];
    children.sort(
      (a, b) => a.orderIndex - b.orderIndex || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    return children.map((n) => toFeatureNodeDto(n, build(n.id)));
  };
  return build(null);
}

export function toEvidenceDto(evidence: FeatureEvidence): FeatureEvidenceDto {
  return {
    id: evidence.id,
    type: evidence.type,
    path: evidence.path,
    ref: evidence.ref,
    title: evidence.title,
    url: evidence.url,
    missing: evidence.missing,
    createdAt: evidence.createdAt.toISOString(),
  };
}

export function toWorkUpdateDto(
  update: WorkUpdate & {
    features: (WorkUpdateFeature & { featureNode: Pick<FeatureNode, 'id' | 'name'> })[];
  },
): WorkUpdateDto {
  return {
    id: update.id,
    source: update.source,
    summary: update.summary,
    changedFiles: Array.isArray(update.changedFiles) ? (update.changedFiles as string[]) : [],
    gitHeadSha: update.gitHeadSha,
    testsStatus: (update.testsStatus as WorkUpdateDto['testsStatus']) ?? null,
    testsSummary: update.testsSummary,
    manualCheck: update.manualCheck,
    nextTask: update.nextTask,
    createdAt: update.createdAt.toISOString(),
    featureIds: update.features.map((f) => f.featureNode.id),
    featureNames: update.features.map((f) => f.featureNode.name),
  };
}

export function toProposalDto(
  proposal: ChangeProposal,
  targetFeatureNames: string[] = [],
): ChangeProposalDto {
  return {
    id: proposal.id,
    type: proposal.type,
    status: proposal.status,
    title: proposal.title,
    reason: proposal.reason,
    targetFeatureIds: proposal.targetFeatureIds,
    targetFeatureNames,
    payload: proposal.payload,
    source: proposal.source,
    createdAt: proposal.createdAt.toISOString(),
    decidedAt: proposal.decidedAt?.toISOString() ?? null,
  };
}

export function toInboxItemDto(
  item: InboxItem & { changeProposal: ChangeProposal | null },
  targetFeatureNames: string[] = [],
): InboxItemDto {
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    title: item.title,
    detail: item.detail,
    changeProposal: item.changeProposal
      ? toProposalDto(item.changeProposal, targetFeatureNames)
      : null,
    featureNodeId: item.featureNodeId,
    createdAt: item.createdAt.toISOString(),
  };
}

export function toOpenQuestionDto(question: OpenQuestion): OpenQuestionDto {
  return {
    id: question.id,
    question: question.question,
    status: question.status,
    featureNodeId: question.featureNodeId,
    createdAt: question.createdAt.toISOString(),
  };
}

export function toVerificationRunDto(run: VerificationRun): VerificationRunDto {
  return {
    id: run.id,
    source: run.source,
    status: run.status,
    name: run.name,
    commitSha: run.commitSha,
    featureNodeId: run.featureNodeId,
    createdAt: run.createdAt.toISOString(),
  };
}
