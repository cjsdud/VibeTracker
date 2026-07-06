import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getNextTask, recordWorkUpdate } from '../src/index.js';
import { createTestDb, createUserAndProject, resetDb } from './helpers.js';

const prisma = createTestDb();

async function activeFeature(
  projectId: string,
  name: string,
  extra: Partial<{
    isCore: boolean;
    implementationStatus: 'NOT_STARTED' | 'PARTIAL' | 'IMPLEMENTED' | 'CHANGED';
    verificationStatus: 'UNKNOWN' | 'NEEDS_VERIFICATION' | 'PASSED' | 'FAILED';
  }> = {},
) {
  return prisma.featureNode.create({
    data: { projectId, name, lifecycle: 'ACTIVE', ...extra },
  });
}

describe('record_work_update', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('코드가 바뀌면 검증 상태가 NEEDS_VERIFICATION이 되고 증거가 연결된다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const feature = await activeFeature(projectId, '로그인', {
      implementationStatus: 'IMPLEMENTED',
      verificationStatus: 'PASSED',
    });
    const result = await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [feature.id],
        summary: '로그인 로직 수정',
        changedFiles: ['src/auth/login.ts'],
        gitHeadSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
    });
    expect(result.untracked).toBe(false);
    expect(result.verificationApplied).toBe('NEEDS_VERIFICATION');

    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.implementationStatus).toBe('CHANGED');
    expect(after.verificationStatus).toBe('NEEDS_VERIFICATION');
    expect(after.lastChangedAt).not.toBeNull();

    const evidence = await prisma.featureEvidence.findMany({
      where: { featureNodeId: feature.id },
    });
    const types = evidence.map((e) => e.type).sort();
    expect(types).toEqual(['COMMIT', 'FILE', 'WORK_UPDATE']);
  });

  it('테스트 통과는 PASSED, 실패는 FAILED + TEST_FAILURE Inbox를 만든다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const passing = await activeFeature(projectId, 'A');
    const failing = await activeFeature(projectId, 'B');

    await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [passing.id],
        summary: '테스트 통과 작업',
        changedFiles: ['a.ts'],
        tests: { status: 'PASSED', passed: 10, failed: 0 },
      },
    });
    await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [failing.id],
        summary: '테스트 실패 작업',
        changedFiles: ['b.ts'],
        tests: { status: 'FAILED', passed: 8, failed: 2, summary: '2건 실패' },
      },
    });

    expect(
      (await prisma.featureNode.findUniqueOrThrow({ where: { id: passing.id } }))
        .verificationStatus,
    ).toBe('PASSED');
    expect(
      (await prisma.featureNode.findUniqueOrThrow({ where: { id: failing.id } }))
        .verificationStatus,
    ).toBe('FAILED');
    expect(
      await prisma.inboxItem.count({ where: { projectId, type: 'TEST_FAILURE', status: 'OPEN' } }),
    ).toBe(1);
    expect(await prisma.verificationRun.count({ where: { projectId } })).toBe(2);
  });

  it('manualCheck는 MANUAL_VERIFIED로 기록된다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const feature = await activeFeature(projectId, '배포');
    await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [feature.id],
        summary: '실제 배포 확인',
        manualCheck: true,
      },
    });
    expect(
      (await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } }))
        .verificationStatus,
    ).toBe('MANUAL_VERIFIED');
  });

  it('featureIds가 없으면 UNTRACKED_CHANGE Inbox 항목을 만든다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const result = await recordWorkUpdate(prisma, {
      input: {
        projectId,
        summary: '어디에 속하는지 모르는 작업',
        changedFiles: ['src/misc/util.ts'],
      },
    });
    expect(result.untracked).toBe(true);
    const items = await prisma.inboxItem.findMany({
      where: { projectId, type: 'UNTRACKED_CHANGE', status: 'OPEN' },
    });
    expect(items).toHaveLength(1);
  });

  it('다른 프로젝트의 featureId는 매칭되지 않는다', async () => {
    const { projectId } = await createUserAndProject(prisma, '1');
    const other = await createUserAndProject(prisma, '2');
    const foreign = await activeFeature(other.projectId, '남의 기능');
    await expect(
      recordWorkUpdate(prisma, {
        input: { projectId, featureIds: [foreign.id], summary: '경계 침범 시도' },
      }),
    ).rejects.toThrow(/찾을 수 없습니다/);
  });

  it('occurredAt 소급 기록은 타임라인만 남기고 현재 상태를 바꾸지 않는다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const feature = await activeFeature(projectId, '로그인', {
      implementationStatus: 'IMPLEMENTED',
      verificationStatus: 'PASSED',
    });
    const pastIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [feature.id],
        summary: '지난주에 했던 로그인 리팩터링 (소급 기록)',
        changedFiles: ['src/auth/login.ts'],
        tests: { status: 'FAILED', failed: 2 },
        occurredAt: pastIso,
      },
    });
    expect(result.historical).toBe(true);
    expect(result.verificationApplied).toBeNull();

    // 상태는 그대로, 타임스탬프는 소급
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.implementationStatus).toBe('IMPLEMENTED');
    expect(after.verificationStatus).toBe('PASSED');
    const update = await prisma.workUpdate.findUniqueOrThrow({
      where: { id: result.workUpdate.id },
    });
    expect(update.createdAt.toISOString()).toBe(pastIso);
    // 과거의 테스트 실패는 Inbox 알림을 만들지 않는다 (검증 기록은 남는다)
    expect(await prisma.inboxItem.count({ where: { projectId, type: 'TEST_FAILURE' } })).toBe(0);
    expect(await prisma.verificationRun.count({ where: { projectId } })).toBe(1);
    // 증거와 타임라인 연결은 정상 생성
    expect(
      await prisma.featureEvidence.count({ where: { featureNodeId: feature.id, type: 'FILE' } }),
    ).toBe(1);
  });

  it('openQuestions와 nextTask가 저장된다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const feature = await activeFeature(projectId, '검색');
    await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [feature.id],
        summary: '검색 개선',
        openQuestions: ['형태소 분석기를 쓸까?'],
        nextTask: '검색 결과 정렬 옵션 추가',
      },
    });
    const questions = await prisma.openQuestion.findMany({ where: { projectId, status: 'OPEN' } });
    expect(questions).toHaveLength(1);
    expect(questions[0]?.featureNodeId).toBe(feature.id);
  });
});

describe('get_next_task 우선순위', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('테스트 실패 > 핵심 검증 필요 > 승인 대기 > 추적 안 됨 > 질문 > 미구현 순서로 고른다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    // 6) 미구현 핵심 기능
    const notStarted = await activeFeature(projectId, '미구현 핵심', {
      isCore: true,
      implementationStatus: 'NOT_STARTED',
    });
    expect((await getNextTask(prisma, projectId)).kind).toBe('IMPLEMENT_CORE_FEATURE');

    // 5) 미해결 질문
    const questioned = await activeFeature(projectId, '질문 많은 기능', {
      implementationStatus: 'PARTIAL',
    });
    await prisma.openQuestion.create({
      data: { projectId, featureNodeId: questioned.id, question: '?' },
    });
    expect((await getNextTask(prisma, projectId)).kind).toBe('RESOLVE_OPEN_QUESTIONS');

    // 4) 추적되지 않은 변경
    await prisma.inboxItem.create({
      data: { projectId, type: 'UNTRACKED_CHANGE', title: '추적 안 됨' },
    });
    expect((await getNextTask(prisma, projectId)).kind).toBe('REVIEW_UNTRACKED_CHANGES');

    // 3) 승인 대기 제안
    await prisma.changeProposal.create({
      data: { projectId, type: 'CREATE', title: '제안', reason: 'r', payload: {} },
    });
    expect((await getNextTask(prisma, projectId)).kind).toBe('REVIEW_PROPOSALS');

    // 2) 핵심 기능 검증 필요
    await prisma.featureNode.update({
      where: { id: notStarted.id },
      data: { implementationStatus: 'CHANGED', verificationStatus: 'NEEDS_VERIFICATION' },
    });
    expect((await getNextTask(prisma, projectId)).kind).toBe('VERIFY_CORE_FEATURE');

    // 1) 테스트 실패가 최우선
    await prisma.featureNode.update({
      where: { id: questioned.id },
      data: { verificationStatus: 'FAILED' },
    });
    const top = await getNextTask(prisma, projectId);
    expect(top.kind).toBe('FIX_FAILING_TESTS');
    expect(top.featureIds).toEqual([questioned.id]);
  });

  it('초안 검토가 대기 중이면 그것부터 안내한다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    await prisma.inboxItem.create({
      data: { projectId, type: 'FEATURE_MAP_REVIEW', title: '검토' },
    });
    expect((await getNextTask(prisma, projectId)).kind).toBe('REVIEW_FEATURE_MAP');
  });

  it('아무것도 없으면 ALL_CLEAR', async () => {
    const { projectId } = await createUserAndProject(prisma);
    expect((await getNextTask(prisma, projectId)).kind).toBe('ALL_CLEAR');
  });
});
