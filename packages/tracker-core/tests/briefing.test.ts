import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBriefing, getProjectContext, recordWorkUpdate } from '../src/index.js';
import { createTestDb, createUserAndProject, resetDb } from './helpers.js';

const prisma = createTestDb();

const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12';

async function setupRepo(projectId: string) {
  await prisma.repository.create({
    data: { projectId, owner: 'demo', name: 'app', fullName: 'demo/app', defaultBranch: 'main' },
  });
}

async function insertPush(projectId: string, branch: string, commits: object[], receivedAt?: Date) {
  return prisma.githubEvent.create({
    data: {
      projectId,
      deliveryId: `d-${Math.random().toString(36).slice(2)}`,
      eventType: 'push',
      payload: { ref: `refs/heads/${branch}`, commits },
      ...(receivedAt ? { receivedAt } : {}),
    },
  });
}

describe('복귀 브리핑 (buildBriefing)', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('빈 프로젝트: 활동 없음이 사실대로 나오고 추천 문장이 없다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const briefing = await buildBriefing(prisma, projectId);

    expect(briefing.elapsed.daysSinceLastActivity).toBeNull();
    expect(briefing.recentWork.basis).toBe('NONE');
    expect(briefing.needsVerification).toEqual([]);
    expect(briefing.broken).toEqual([]);
    expect(briefing.briefingText).toContain('복귀 브리핑');
    // 추천 엔진 금지: 판단/지시 문장을 만들지 않는다
    expect(briefing.briefingText).not.toContain('하세요');
    expect(briefing.briefingText).not.toContain('추천');
    expect(briefing.briefingText).not.toContain('우선');
  });

  it('5개 섹션이 모두 채워진다: 경과·지난 작업·검증 필요·최근 코드 변경·문제 있음', async () => {
    const { projectId } = await createUserAndProject(prisma);
    await setupRepo(projectId);
    const needsVerify = await prisma.featureNode.create({
      data: {
        projectId,
        name: '관리자 권한',
        lifecycle: 'ACTIVE',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'NEEDS_VERIFICATION',
      },
    });
    const broken = await prisma.featureNode.create({
      data: {
        projectId,
        name: '결제',
        lifecycle: 'ACTIVE',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'FAILED',
      },
    });
    await prisma.openQuestion.create({
      data: { projectId, featureNodeId: broken.id, question: '환불 정책은 어디에 정의하나?' },
    });
    // 작업 기록은 별도 기능에 남긴다 (검증 필요 상태인 '관리자 권한'을 건드리지 않도록)
    const workedOn = await prisma.featureNode.create({
      data: { projectId, name: '알림 보내기', lifecycle: 'ACTIVE' },
    });
    await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [workedOn.id],
        summary: '권한 노출 조건 수정',
        tests: { status: 'PASSED', passed: 5 },
      },
    });
    await insertPush(projectId, 'main', [{ id: SHA, message: 'fix: admin auth' }]);
    await prisma.verificationRun.create({
      data: { projectId, source: 'CI', status: 'PASSED', name: 'CI', commitSha: SHA },
    });
    await prisma.featureBranchActivity.create({
      data: {
        projectId,
        featureNodeId: needsVerify.id,
        branch: 'feature/admin-auth-fix',
        summary: '노출 조건 수정 중',
        prNumber: 12,
        prState: 'open',
        source: 'GITHUB_WEBHOOK',
      },
    });

    const briefing = await buildBriefing(prisma, projectId);

    // 1. 경과
    expect(briefing.elapsed.daysSinceLastActivity).toBe(0);
    expect(briefing.elapsed.lastWorkRecordAt).not.toBeNull();
    // 2. 지난 작업 (MCP 기록 기반)
    expect(briefing.recentWork.basis).toBe('WORK_RECORDS');
    expect(briefing.recentWork.items[0]?.summary).toContain('권한 노출 조건');
    // 3. 검증 필요 — 사실 나열
    expect(briefing.needsVerification.map((f) => f.name)).toContain('관리자 권한');
    // 4. 최근 코드 변경
    expect(briefing.recentCodeChanges.latestCi?.status).toBe('PASSED');
    expect(briefing.recentCodeChanges.unmergedBranches).toHaveLength(1);
    expect(briefing.recentCodeChanges.unmergedBranches[0]).toMatchObject({
      branch: 'feature/admin-auth-fix',
      featureNames: ['관리자 권한'],
      prNumber: 12,
      prState: 'open',
    });
    // 5. 문제 있음 + 미해결 질문
    expect(briefing.broken).toHaveLength(1);
    expect(briefing.broken[0]?.name).toBe('결제');
    expect(briefing.broken[0]?.openQuestions[0]).toContain('환불 정책');

    // 사람이 읽는 텍스트에 전부 반영
    expect(briefing.briefingText).toContain('관리자 권한');
    expect(briefing.briefingText).toContain('main 미반영: feature/admin-auth-fix');
    expect(briefing.briefingText).toContain('결제');
    expect(briefing.briefingText).toContain('환불 정책');
  });

  it('MCP 기록이 하나도 없으면 지난 작업이 커밋 메시지 기반으로 폴백된다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    await setupRepo(projectId);
    await insertPush(projectId, 'main', [
      { id: SHA, message: 'feat: add admin page\n\ndetails' },
      { id: SHA.replace('a', 'b'), message: 'fix: login redirect' },
    ]);
    // feature 브랜치 커밋은 main 커밋 수에 들어가지 않는다
    await insertPush(projectId, 'feature/x', [{ id: SHA.replace('a', 'c'), message: 'wip' }]);

    const briefing = await buildBriefing(prisma, projectId);
    expect(briefing.recentWork.basis).toBe('COMMITS');
    const summaries = briefing.recentWork.items.map((i) => i.summary);
    expect(summaries).toContain('feat: add admin page');
    expect(summaries).toContain('fix: login redirect');
    expect(summaries).not.toContain('wip');
    expect(briefing.recentCodeChanges.defaultBranchCommitCount).toBe(2);
    expect(briefing.briefingText).toContain('커밋 메시지 기반');
  });

  it('경과 일수는 마지막 작업 기록/커밋 중 최근 것 기준으로 계산된다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const feature = await prisma.featureNode.create({
      data: { projectId, name: '검색', lifecycle: 'ACTIVE' },
    });
    // 8일 전 소급 작업 기록
    await recordWorkUpdate(prisma, {
      input: {
        projectId,
        featureIds: [feature.id],
        summary: '지난주 작업',
        occurredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const briefing = await buildBriefing(prisma, projectId);
    expect(briefing.elapsed.daysSinceLastActivity).toBe(8);
    expect(briefing.briefingText).toContain('8일 지남');
  });

  it('get_project_context는 브리핑을 포함하고 추천(nextTask)을 포함하지 않는다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    await prisma.featureNode.create({
      data: { projectId, name: '로그인', lifecycle: 'ACTIVE', isCore: true },
    });
    const context = await getProjectContext(prisma, projectId);
    expect(context.briefing.briefingText).toContain('복귀 브리핑');
    expect(context.featureTreeSummary).toContain('로그인');
    expect('nextTask' in context).toBe(false);
  });
});
