import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { approveInitialFeatureMap, bootstrapProjectMap, getFeatureTree } from '../src/index.js';
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

  it('재부트스트랩은 기존 DRAFT를 교체하지만 ACTIVE 트리가 있으면 거부한다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    await bootstrapProjectMap(prisma, { input: sampleMap(projectId) });
    expect(await prisma.featureNode.count({ where: { projectId } })).toBe(4);

    await approveInitialFeatureMap(prisma, { projectId, userId });
    await expect(bootstrapProjectMap(prisma, { input: sampleMap(projectId) })).rejects.toThrow(
      /이미 승인된/,
    );
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
