import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approveInitialFeatureMap,
  approveProposal,
  bootstrapProjectMap,
  createProposal,
  getDashboardCounts,
  getFeatureTree,
  getNextTask,
  recordWorkUpdate,
} from '../src/index.js';
import { createTestDb, createUserAndProject, resetDb } from './helpers.js';

const prisma = createTestDb();

const sampleMap = (projectId: string) => ({
  projectId,
  baseCommitSha: 'abc123def456',
  projectGoal: '테스트 목표',
  features: [
    {
      name: '사용자 접근',
      isCore: true,
      children: [
        {
          name: '로그인',
          isCore: true,
          implementationStatus: 'IMPLEMENTED' as const,
          evidence: {
            files: ['src/auth/login.ts'],
            routes: ['/login'],
            apiEndpoints: ['POST /api/login'],
            tests: ['src/auth/login.test.ts'],
          },
        },
      ],
    },
    { name: '데이터 업로드', children: [{ name: '파일 업로드' }] },
  ],
});

describe('feature tree bootstrap + approval', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('bootstrap은 무조건 DRAFT로 생성하고 검토 Inbox 항목을 만든다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const result = await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });

    expect(result.draftCount).toBe(4);
    const nodes = await prisma.featureNode.findMany({ where: { projectId } });
    expect(nodes).toHaveLength(4);
    expect(nodes.every((n) => n.lifecycle === 'DRAFT')).toBe(true);

    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.goal).toBe('테스트 목표');

    const inbox = await prisma.inboxItem.findMany({
      where: { projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
    });
    expect(inbox).toHaveLength(1);

    // 증거는 FeatureEvidence에만 저장된다
    const evidence = await prisma.featureEvidence.findMany({ where: { projectId } });
    expect(evidence.map((e) => e.type).sort()).toEqual(['API_ENDPOINT', 'FILE', 'ROUTE', 'TEST']);
  });

  it('재부트스트랩은 기존 DRAFT만 교체한다 (승인 전)', async () => {
    const { projectId } = await createUserAndProject(prisma);
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    expect(await prisma.featureNode.count({ where: { projectId } })).toBe(4);
    // 이전 검토 항목은 DISMISSED, 새 항목만 OPEN
    expect(
      await prisma.inboxItem.count({
        where: { projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('승인하면 전체가 ACTIVE가 되고 트리 버전과 감사 로그가 남는다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    const { version } = await approveInitialFeatureMap(prisma, { projectId, userId });

    expect(version).toBe(1);
    const nodes = await prisma.featureNode.findMany({ where: { projectId } });
    expect(nodes.every((n) => n.lifecycle === 'ACTIVE')).toBe(true);

    const versions = await prisma.featureTreeVersion.findMany({ where: { projectId } });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.cause).toBe('BOOTSTRAP_APPROVED');

    const inbox = await prisma.inboxItem.findMany({
      where: { projectId, type: 'FEATURE_MAP_REVIEW' },
    });
    expect(inbox[0]?.status).toBe('RESOLVED');

    const audit = await prisma.auditLog.findMany({
      where: { projectId, action: 'feature_map.approved' },
    });
    expect(audit).toHaveLength(1);
  });

  it('승인할 초안이 없으면 승인은 실패한다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    await expect(approveInitialFeatureMap(prisma, { projectId, userId })).rejects.toThrow(/초안/);
  });

  it('트리는 orderIndex 순서의 중첩 구조로 조립된다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    const tree = await getFeatureTree(prisma, projectId);
    expect(tree.map((n) => n.name)).toEqual(['사용자 접근', '데이터 업로드']);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['로그인']);
    expect(tree[0]?.children[0]?.displayStatus).toBe('AWAITING_APPROVAL');
  });
});

/**
 * 시나리오 B: 이미 승인된 지도가 있는 프로젝트에서 지도를 다시 만드는 경우 (지도 교체).
 * 시나리오 A(위: 신규 프로젝트 첫 지도)와 대비되는 실사용 흐름 전체를 검증한다.
 */
describe('시나리오 B: 기능 지도 교체 (ACTIVE 지도 위에 재부트스트랩)', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  const replacementMap = (projectId: string) => ({
    projectId,
    baseCommitSha: 'def456abc789',
    features: [
      {
        name: '진짜 지도 영역',
        isCore: true,
        children: [
          { name: '진짜 기능 1', implementationStatus: 'IMPLEMENTED' as const },
          { name: '진짜 기능 2' },
        ],
      },
    ],
  });

  async function approvedProject() {
    const { projectId, userId } = await createUserAndProject(prisma);
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    await approveInitialFeatureMap(prisma, { projectId, userId });
    return { projectId, userId };
  }

  it('B1: ACTIVE 지도가 있어도 bootstrap이 거부되지 않고 교체 초안이 만들어진다', async () => {
    const { projectId } = await approvedProject();
    const result = await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });

    expect(result.replacesActiveMap).toBe(true);
    expect(result.draftCount).toBe(3);
    // 기존 ACTIVE 지도는 아무것도 바뀌지 않는다 (승인 전 무변경 원칙)
    expect(await prisma.featureNode.count({ where: { projectId, lifecycle: 'ACTIVE' } })).toBe(4);
    expect(await prisma.featureNode.count({ where: { projectId, lifecycle: 'DRAFT' } })).toBe(3);
    // 교체 안내가 담긴 검토 항목이 열린다
    const review = await prisma.inboxItem.findFirstOrThrow({
      where: { projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
    });
    expect(review.title).toContain('교체');
    expect((review.detail as { replacesActiveMap?: boolean }).replacesActiveMap).toBe(true);
  });

  it('B2: 교체 초안이 마음에 안 들면 재부트스트랩으로 초안만 갈아치운다 (ACTIVE 무사)', async () => {
    const { projectId } = await approvedProject();
    await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });
    await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });

    expect(await prisma.featureNode.count({ where: { projectId, lifecycle: 'ACTIVE' } })).toBe(4);
    expect(await prisma.featureNode.count({ where: { projectId, lifecycle: 'DRAFT' } })).toBe(3);
    expect(
      await prisma.inboxItem.count({
        where: { projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('B3: 교체 승인 시 기존 지도 전체가 RETIRED(삭제 아님)되고 초안이 ACTIVE가 된다', async () => {
    const { projectId, userId } = await approvedProject();
    const oldNodes = await prisma.featureNode.findMany({ where: { projectId } });
    await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });

    const result = await approveInitialFeatureMap(prisma, { projectId, userId });
    expect(result.retiredCount).toBe(4);
    expect(result.version).toBe(2); // 첫 승인이 v1, 교체 승인이 v2

    // 기존 노드는 전부 RETIRED + retiredAt (DB에서 삭제되지 않음)
    for (const old of oldNodes) {
      const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: old.id } });
      expect(after.lifecycle).toBe('RETIRED');
      expect(after.retiredAt).not.toBeNull();
    }
    // 새 지도만 ACTIVE
    const active = await prisma.featureNode.findMany({
      where: { projectId, lifecycle: 'ACTIVE' },
    });
    expect(active.map((n) => n.name).sort()).toEqual(['진짜 기능 1', '진짜 기능 2', '진짜 지도 영역']);
    // 검토 항목은 닫힌다
    expect(
      await prisma.inboxItem.count({
        where: { projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
      }),
    ).toBe(0);
  });

  it('B4: 교체돼 종료된 기능의 작업 기록과 증거는 보존된다', async () => {
    const { projectId, userId } = await approvedProject();
    const oldFeature = await prisma.featureNode.findFirstOrThrow({
      where: { projectId, name: '로그인' },
    });
    await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [oldFeature.id],
        summary: '교체 전 작업',
        changedFiles: ['src/auth/login.ts'],
      },
    });
    const evidenceBefore = await prisma.featureEvidence.count({
      where: { featureNodeId: oldFeature.id },
    });
    expect(evidenceBefore).toBeGreaterThan(0);

    await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });
    await approveInitialFeatureMap(prisma, { projectId, userId });

    // 종료됐지만 기록/증거는 그대로
    expect(
      await prisma.featureEvidence.count({ where: { featureNodeId: oldFeature.id } }),
    ).toBe(evidenceBefore);
    expect(
      await prisma.workUpdateFeature.count({ where: { featureNodeId: oldFeature.id } }),
    ).toBe(1);
  });

  it('B5: 교체 승인 후 대시보드 집계와 다음 작업이 새 지도 기준으로 동작한다', async () => {
    const { projectId, userId } = await approvedProject();
    await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });
    await approveInitialFeatureMap(prisma, { projectId, userId });

    const counts = await getDashboardCounts(prisma, projectId);
    expect(counts.activeFeatures).toBe(3);
    expect(counts.draftFeatures).toBe(0);

    const next = await getNextTask(prisma, projectId);
    // 새 지도의 미구현 핵심 영역이 잡힌다 (종료된 옛 기능은 무시)
    expect(next.featureIds.length + 1).toBeGreaterThan(0);
    const referenced = await prisma.featureNode.findMany({
      where: { id: { in: next.featureIds } },
    });
    expect(referenced.every((n) => n.lifecycle === 'ACTIVE')).toBe(true);
  });

  it('B7: 교체 승인 시 옛 지도 기준의 PENDING 제안은 만료되고 Inbox도 정리된다', async () => {
    const { projectId, userId } = await approvedProject();
    const oldFeature = await prisma.featureNode.findFirstOrThrow({
      where: { projectId, name: '로그인' },
    });
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'RENAME',
        reason: '옛 지도 기준 제안',
        targetFeatureIds: [oldFeature.id],
        newName: '통합 로그인',
      },
    });
    await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });
    await approveInitialFeatureMap(prisma, { projectId, userId });

    const after = await prisma.changeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(after.status).toBe('REJECTED');
    expect(
      await prisma.inboxItem.count({ where: { changeProposalId: proposal.id, status: 'OPEN' } }),
    ).toBe(0);
    // 옛 이름 그대로 (적용 안 됨)
    const feature = await prisma.featureNode.findUniqueOrThrow({ where: { id: oldFeature.id } });
    expect(feature.name).toBe('로그인');
  });

  it('B8: 종료된 기능을 대상으로 한 제안은 승인 시점에 거부된다', async () => {
    const { projectId, userId } = await approvedProject();
    const target = await prisma.featureNode.findFirstOrThrow({
      where: { projectId, name: '로그인' },
    });
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'RENAME',
        reason: 'r',
        targetFeatureIds: [target.id],
        newName: '새 이름',
      },
    });
    // 제안 생성 후 대상이 종료됨 (지도 교체와 무관한 경로로도 가능)
    await prisma.featureNode.update({
      where: { id: target.id },
      data: { lifecycle: 'RETIRED', retiredAt: new Date() },
    });
    await expect(
      approveProposal(prisma, { projectId, userId, proposalId: proposal.id }),
    ).rejects.toThrow(/이미 종료/);
  });

  it('B9: 재부트스트랩은 초안에 붙었던 질문/Inbox/작업 기록을 잃지 않는다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    const draft = await prisma.featureNode.findFirstOrThrow({
      where: { projectId, name: '로그인', lifecycle: 'DRAFT' },
    });
    const record = await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [draft.id],
        summary: '초안 단계에서 한 작업',
        changedFiles: ['src/auth/login.ts'],
        tests: { status: 'FAILED', failed: 1 },
        openQuestions: ['초안 단계 질문'],
      },
    });

    // 재부트스트랩 → 초안 노드는 교체되지만 사용자 데이터는 보존
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });

    const questions = await prisma.openQuestion.findMany({
      where: { projectId, status: 'OPEN' },
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]?.featureNodeId).toBeNull();

    const failures = await prisma.inboxItem.findMany({
      where: { projectId, type: 'TEST_FAILURE' },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.featureNodeId).toBeNull();

    // 링크를 전부 잃은 작업 기록은 untracked로 재분류된다
    expect(
      await prisma.inboxItem.count({
        where: { projectId, type: 'UNTRACKED_CHANGE', workUpdateId: record.workUpdate.id },
      }),
    ).toBe(1);
    // 작업 기록 본체는 그대로
    expect(
      await prisma.workUpdate.count({ where: { id: record.workUpdate.id } }),
    ).toBe(1);
  });

  it('B6: 승인 없이 초안만 있으면 아무 것도 교체되지 않는다 (조회 안정성)', async () => {
    const { projectId } = await approvedProject();
    await bootstrapProjectMap(prisma, { input: replacementMap(projectId) });

    // 트리 조회는 ACTIVE+DRAFT를 모두 보여주되 서로 섞이지 않는다
    const tree = await getFeatureTree(prisma, projectId);
    const roots = tree.map((n) => `${n.name}:${n.lifecycle}`).sort();
    expect(roots).toEqual([
      '데이터 업로드:ACTIVE',
      '사용자 접근:ACTIVE',
      '진짜 지도 영역:DRAFT',
    ]);
  });
});
