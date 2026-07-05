import {
  deriveDisplayStatus,
  type DashboardCounts,
  type FeatureDetailDto,
  type NextTaskDto,
  type WorkUpdateDto,
} from '@vibetrack/shared';
import { type Db, type FeatureNode } from '../db.js';
import {
  toEvidenceDto,
  toFeatureNodeDto,
  toOpenQuestionDto,
  toProposalDto,
  toVerificationRunDto,
  toWorkUpdateDto,
} from '../dto.js';
import { requireFeature } from './featureTree.js';
import { getNextTask } from './nextTask.js';

const workUpdateInclude = {
  features: { include: { featureNode: { select: { id: true, name: true } } } },
} as const;

export async function getDashboardCounts(db: Db, projectId: string): Promise<DashboardCounts> {
  const [
    coreFeatures,
    activeFeatures,
    needsVerification,
    pendingProposals,
    untrackedChanges,
    openQuestions,
    draftFeatures,
  ] = await Promise.all([
    db.featureNode.count({ where: { projectId, lifecycle: 'ACTIVE', isCore: true } }),
    db.featureNode.count({ where: { projectId, lifecycle: 'ACTIVE' } }),
    db.featureNode.count({
      where: {
        projectId,
        lifecycle: 'ACTIVE',
        verificationStatus: { in: ['NEEDS_VERIFICATION', 'FAILED'] },
      },
    }),
    db.changeProposal.count({ where: { projectId, status: 'PENDING' } }),
    db.inboxItem.count({ where: { projectId, type: 'UNTRACKED_CHANGE', status: 'OPEN' } }),
    db.openQuestion.count({ where: { projectId, status: 'OPEN' } }),
    db.featureNode.count({ where: { projectId, lifecycle: 'DRAFT' } }),
  ]);
  return {
    coreFeatures,
    activeFeatures,
    needsVerification,
    pendingProposals,
    untrackedChanges,
    openQuestions,
    draftFeatures,
  };
}

export async function getRecentWorkUpdates(
  db: Db,
  projectId: string,
  limit = 5,
): Promise<WorkUpdateDto[]> {
  const updates = await db.workUpdate.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: workUpdateInclude,
  });
  return updates.map(toWorkUpdateDto);
}

/** 트리를 들여쓰기 텍스트로 압축한다. MCP 컨텍스트는 토큰을 아껴야 한다. */
function compactTreeLines(nodes: FeatureNode[]): string[] {
  const byParent = new Map<string | null, FeatureNode[]>();
  for (const node of nodes) {
    if (node.lifecycle === 'RETIRED') continue;
    const key = node.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }
  const lines: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const node of children) {
      const status = deriveDisplayStatus(node);
      const flags = [
        node.isCore ? 'core' : null,
        node.lifecycle === 'DRAFT' ? 'draft' : null,
      ].filter(Boolean);
      lines.push(
        `${'  '.repeat(depth)}- ${node.name} [id:${node.id}] (${status}${flags.length ? ', ' + flags.join(',') : ''})`,
      );
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines;
}

export interface ProjectContext {
  project: { id: string; name: string; goal: string | null };
  repository: { fullName: string; defaultBranch: string } | null;
  featureTreeSummary: string;
  counts: DashboardCounts;
  recentWork: {
    summary: string;
    featureNames: string[];
    testsStatus: string | null;
    createdAt: string;
  }[];
  needsVerification: { id: string; name: string; isCore: boolean }[];
  openQuestions: { question: string; featureName: string | null }[];
  pendingProposals: { id: string; type: string; title: string }[];
  focusFeatures?: FeatureDetailDto[];
  nextTask: NextTaskDto;
}

/** get_project_context: 프로젝트의 압축된 전체 맥락 */
export async function getProjectContext(
  db: Db,
  projectId: string,
  focusFeatureIds?: string[],
): Promise<ProjectContext> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { repository: true },
  });
  const nodes = await db.featureNode.findMany({ where: { projectId } });
  const [counts, recentWork, needsVerification, openQuestions, pendingProposals, nextTask] =
    await Promise.all([
      getDashboardCounts(db, projectId),
      getRecentWorkUpdates(db, projectId, 5),
      db.featureNode.findMany({
        where: {
          projectId,
          lifecycle: 'ACTIVE',
          verificationStatus: { in: ['NEEDS_VERIFICATION', 'FAILED'] },
        },
        select: { id: true, name: true, isCore: true },
        orderBy: [{ isCore: 'desc' }, { lastChangedAt: 'desc' }],
        take: 10,
      }),
      db.openQuestion.findMany({
        where: { projectId, status: 'OPEN' },
        include: { featureNode: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.changeProposal.findMany({
        where: { projectId, status: 'PENDING' },
        select: { id: true, type: true, title: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      getNextTask(db, projectId),
    ]);

  const focusFeatures: FeatureDetailDto[] = [];
  for (const featureId of focusFeatureIds ?? []) {
    try {
      focusFeatures.push(await getFeatureContext(db, projectId, featureId));
    } catch {
      // 존재하지 않는 focus ID는 조용히 건너뛴다
    }
  }

  return {
    project: { id: project.id, name: project.name, goal: project.goal },
    repository: project.repository
      ? { fullName: project.repository.fullName, defaultBranch: project.repository.defaultBranch }
      : null,
    featureTreeSummary: compactTreeLines(nodes).join('\n'),
    counts,
    recentWork: recentWork.map((w) => ({
      summary: w.summary,
      featureNames: w.featureNames,
      testsStatus: w.testsStatus,
      createdAt: w.createdAt,
    })),
    needsVerification,
    openQuestions: openQuestions.map((q) => ({
      question: q.question,
      featureName: q.featureNode?.name ?? null,
    })),
    pendingProposals,
    ...(focusFeatures.length ? { focusFeatures } : {}),
    nextTask,
  };
}

/** get_feature_context / 기능 상세 화면: 특정 기능의 상세 맥락 */
export async function getFeatureContext(
  db: Db,
  projectId: string,
  featureId: string,
): Promise<FeatureDetailDto> {
  const node = await requireFeature(db, projectId, featureId);
  const [parent, evidence, updates, questions, runs, proposals] = await Promise.all([
    node.parentId
      ? db.featureNode.findUnique({ where: { id: node.parentId }, select: { name: true } })
      : Promise.resolve(null),
    db.featureEvidence.findMany({
      where: { featureNodeId: featureId },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    db.workUpdate.findMany({
      where: { projectId, features: { some: { featureNodeId: featureId } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: workUpdateInclude,
    }),
    db.openQuestion.findMany({
      where: { featureNodeId: featureId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 20,
    }),
    db.verificationRun.findMany({
      where: { featureNodeId: featureId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.changeProposal.findMany({
      where: { projectId, targetFeatureIds: { has: featureId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const { children: _children, ...nodeDto } = toFeatureNodeDto(node);
  return {
    node: nodeDto,
    parentName: parent?.name ?? null,
    evidence: evidence.map(toEvidenceDto),
    workUpdates: updates.map(toWorkUpdateDto),
    openQuestions: questions.map(toOpenQuestionDto),
    verificationRuns: runs.map(toVerificationRunDto),
    relatedProposals: proposals.map((p) => toProposalDto(p)),
  };
}
