import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient, type Prisma, type PrismaClient } from '@vibetrack/tracker-core';
import { processGithubEvent } from '../src/processor.js';

const prisma: PrismaClient = createPrismaClient(
  process.env.TEST_DATABASE_URL ?? 'postgresql://vibetrack:vibetrack@localhost:5432/vibetrack_test',
);

async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function setup() {
  const user = await prisma.user.create({ data: { name: '테스터' } });
  const project = await prisma.project.create({ data: { userId: user.id, name: 'P' } });
  const feature = await prisma.featureNode.create({
    data: {
      projectId: project.id,
      name: '로그인',
      lifecycle: 'ACTIVE',
      implementationStatus: 'IMPLEMENTED',
      verificationStatus: 'PASSED',
    },
  });
  await prisma.featureEvidence.create({
    data: {
      projectId: project.id,
      featureNodeId: feature.id,
      type: 'FILE',
      path: 'src/auth/login.ts',
    },
  });
  return { project, feature };
}

async function insertEvent(
  projectId: string | null,
  eventType: string,
  payload: Prisma.InputJsonValue,
  deliveryId = `d-${Math.random().toString(36).slice(2)}`,
) {
  return prisma.githubEvent.create({
    data: { projectId, deliveryId, eventType, payload },
  });
}

const SHA = 'f00dbabef00dbabef00dbabef00dbabef00dbabe';

describe('GitHub event processor', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('push: 증거 파일과 매칭되면 커밋 증거 + CHANGED + NEEDS_VERIFICATION', async () => {
    const { project, feature } = await setup();
    const event = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [
        { id: SHA, message: 'fix login', added: [], modified: ['src/auth/login.ts'], removed: [] },
      ],
    });
    await processGithubEvent(prisma, event.id);

    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.implementationStatus).toBe('CHANGED');
    expect(after.verificationStatus).toBe('NEEDS_VERIFICATION');
    const commitEvidence = await prisma.featureEvidence.findFirst({
      where: { featureNodeId: feature.id, type: 'COMMIT', ref: SHA },
    });
    expect(commitEvidence).not.toBeNull();
    expect((await prisma.githubEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'PROCESSED',
    );
    // 매칭됐으므로 untracked 항목은 없다
    expect(await prisma.inboxItem.count({ where: { type: 'UNTRACKED_CHANGE' } })).toBe(0);
  });

  it('push: 어떤 기능과도 매칭되지 않으면 UNTRACKED_CHANGE Inbox 항목 생성', async () => {
    const { project, feature } = await setup();
    const event = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [{ id: SHA, message: 'misc', added: ['scripts/tmp.ts'], modified: [], removed: [] }],
    });
    await processGithubEvent(prisma, event.id);

    const items = await prisma.inboxItem.findMany({
      where: { projectId: project.id, type: 'UNTRACKED_CHANGE', status: 'OPEN' },
    });
    expect(items).toHaveLength(1);
    // 기능 상태는 그대로
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.verificationStatus).toBe('PASSED');
  });

  it('push: 파일 삭제 시 기능을 삭제하지 않고 증거만 missing 처리 + 불일치 후보 생성', async () => {
    const { project, feature } = await setup();
    const event = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [
        { id: SHA, message: 'rm', added: [], modified: [], removed: ['src/auth/login.ts'] },
      ],
    });
    await processGithubEvent(prisma, event.id);

    const node = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(node.lifecycle).toBe('ACTIVE'); // 자동 삭제 금지
    const evidence = await prisma.featureEvidence.findFirstOrThrow({
      where: { featureNodeId: feature.id, type: 'FILE' },
    });
    expect(evidence.missing).toBe(true);
    expect(
      await prisma.inboxItem.count({
        where: { projectId: project.id, type: 'EVIDENCE_MISMATCH', status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('push: 같은 파일명이 새 경로에 추가되면 증거 경로를 갱신한다 (rename)', async () => {
    const { project, feature } = await setup();
    const event = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [
        {
          id: SHA,
          message: 'move',
          added: ['src/server/auth/login.ts'],
          modified: [],
          removed: ['src/auth/login.ts'],
        },
      ],
    });
    await processGithubEvent(prisma, event.id);
    const evidence = await prisma.featureEvidence.findFirstOrThrow({
      where: { featureNodeId: feature.id, type: 'FILE' },
    });
    expect(evidence.path).toBe('src/server/auth/login.ts');
    expect(evidence.missing).toBe(false);
  });

  it('push: MCP 기록과 커밋 파일이 전혀 겹치지 않으면 EVIDENCE_MISMATCH 생성', async () => {
    const { project, feature } = await setup();
    await prisma.workUpdate.create({
      data: {
        projectId: project.id,
        source: 'MCP',
        summary: '로그인 수정했다고 기록',
        changedFiles: ['src/auth/login.ts'],
        gitHeadSha: SHA,
        features: { create: [{ featureNodeId: feature.id }] },
      },
    });
    const event = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [
        {
          id: SHA,
          message: 'actually different',
          added: [],
          modified: ['src/other/place.ts'],
          removed: [],
        },
      ],
    });
    await processGithubEvent(prisma, event.id);
    const mismatches = await prisma.inboxItem.findMany({
      where: { projectId: project.id, type: 'EVIDENCE_MISMATCH' },
    });
    expect(mismatches.length).toBeGreaterThanOrEqual(1);
  });

  it('check_run 실패: SHA로 기능을 찾아 FAILED + TEST_FAILURE Inbox', async () => {
    const { project, feature } = await setup();
    await prisma.workUpdate.create({
      data: {
        projectId: project.id,
        source: 'MCP',
        summary: '작업',
        gitHeadSha: SHA,
        features: { create: [{ featureNodeId: feature.id }] },
      },
    });
    const event = await insertEvent(project.id, 'check_run', {
      action: 'completed',
      check_run: { name: 'CI / test', head_sha: SHA, conclusion: 'failure' },
    });
    await processGithubEvent(prisma, event.id);

    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.verificationStatus).toBe('FAILED');
    expect(
      await prisma.verificationRun.count({
        where: { projectId: project.id, status: 'FAILED', source: 'CI' },
      }),
    ).toBe(1);
    expect(
      await prisma.inboxItem.count({
        where: { projectId: project.id, type: 'TEST_FAILURE', status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('workflow_run 성공: 검증 상태 PASSED', async () => {
    const { project, feature } = await setup();
    await prisma.featureNode.update({
      where: { id: feature.id },
      data: { verificationStatus: 'NEEDS_VERIFICATION' },
    });
    await prisma.featureEvidence.create({
      data: { projectId: project.id, featureNodeId: feature.id, type: 'COMMIT', ref: SHA },
    });
    const event = await insertEvent(project.id, 'workflow_run', {
      action: 'completed',
      workflow_run: { name: 'CI', head_sha: SHA, conclusion: 'success' },
    });
    await processGithubEvent(prisma, event.id);
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.verificationStatus).toBe('PASSED');
  });

  it('이미 처리된 이벤트는 다시 처리하지 않는다 (중복 방지)', async () => {
    const { project } = await setup();
    const event = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [{ id: SHA, message: 'misc', added: ['scripts/x.ts'], modified: [], removed: [] }],
    });
    await processGithubEvent(prisma, event.id);
    await processGithubEvent(prisma, event.id); // 재처리 시도
    expect(
      await prisma.inboxItem.count({ where: { projectId: project.id, type: 'UNTRACKED_CHANGE' } }),
    ).toBe(1);
  });

  it('부분 실패 후 재시도(FAILED → 재처리)해도 Inbox/검증 기록이 중복되지 않는다', async () => {
    const { project, feature } = await setup();
    await prisma.workUpdate.create({
      data: {
        projectId: project.id,
        source: 'MCP',
        summary: '작업',
        gitHeadSha: SHA,
        features: { create: [{ featureNodeId: feature.id }] },
      },
    });
    const push = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [{ id: SHA, message: 'misc', added: ['scripts/x.ts'], modified: [], removed: [] }],
    });
    const check = await insertEvent(project.id, 'check_run', {
      action: 'completed',
      check_run: { name: 'CI / test', head_sha: SHA, conclusion: 'failure' },
    });
    await processGithubEvent(prisma, push.id);
    await processGithubEvent(prisma, check.id);
    // 마지막 단계에서 실패했다고 가정하고 상태를 되돌린 뒤 재시도
    await prisma.githubEvent.updateMany({
      where: { id: { in: [push.id, check.id] } },
      data: { status: 'FAILED' },
    });
    await processGithubEvent(prisma, push.id);
    await processGithubEvent(prisma, check.id);

    expect(
      await prisma.inboxItem.count({ where: { projectId: project.id, type: 'UNTRACKED_CHANGE' } }),
    ).toBe(1);
    expect(
      await prisma.inboxItem.count({ where: { projectId: project.id, type: 'TEST_FAILURE' } }),
    ).toBe(1);
    expect(
      await prisma.verificationRun.count({ where: { projectId: project.id, source: 'CI' } }),
    ).toBe(1);
  });

  it('프로젝트에 매핑되지 않은 이벤트는 SKIPPED 처리한다', async () => {
    const event = await insertEvent(null, 'push', { commits: [] });
    await processGithubEvent(prisma, event.id);
    expect((await prisma.githubEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'SKIPPED',
    );
  });

  it('push(main): MCP 기록이 하나도 없어도 상태 전이가 일어나고 출처가 남는다', async () => {
    const { project, feature } = await setup();
    const event = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [
        { id: SHA, message: 'fix', added: [], modified: ['src/auth/login.ts'], removed: [] },
      ],
    });
    await processGithubEvent(prisma, event.id);
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.verificationStatus).toBe('NEEDS_VERIFICATION');
    expect(after.lastStatusSource).toBe('GITHUB_WEBHOOK');
    expect(await prisma.workUpdate.count({ where: { projectId: project.id } })).toBe(0);
  });
});

// ---------- P2: 브랜치 상태와 공식(main) 상태 분리 ----------

async function setupWithRepo() {
  const base = await setup();
  await prisma.repository.create({
    data: {
      projectId: base.project.id,
      owner: 'demo',
      name: 'app',
      fullName: 'demo/app',
      defaultBranch: 'main',
    },
  });
  return base;
}

const BRANCH = 'feature/admin-auth-fix';

async function pushToBranch(projectId: string, branch: string, files: string[], sha = SHA) {
  const event = await insertEvent(projectId, 'push', {
    ref: `refs/heads/${branch}`,
    commits: [{ id: sha, message: '노출 조건 수정', added: [], modified: files, removed: [] }],
  });
  await processGithubEvent(prisma, event.id);
  return event;
}

describe('P2: 브랜치 작업 중 변경 vs 공식 상태', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('feature 브랜치 push는 공식 상태를 바꾸지 않고 "작업 중 변경"으로만 기록한다', async () => {
    const { project, feature } = await setupWithRepo();
    await pushToBranch(project.id, BRANCH, ['src/auth/login.ts', 'scripts/tmp.ts']);

    // 공식 상태 불변
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.implementationStatus).toBe('IMPLEMENTED');
    expect(after.verificationStatus).toBe('PASSED');
    expect(after.lastStatusSource).toBeNull();

    // 작업 중 변경 기록
    const activity = await prisma.featureBranchActivity.findUniqueOrThrow({
      where: { featureNodeId_branch: { featureNodeId: feature.id, branch: BRANCH } },
    });
    expect(activity.lastCommitSha).toBe(SHA);
    expect(activity.source).toBe('GITHUB_WEBHOOK');
    expect(activity.summary).toContain('노출 조건');

    // 브랜치 push는 untracked Inbox를 만들지 않는다 (main 기준에서만 판단)
    expect(
      await prisma.inboxItem.count({ where: { projectId: project.id, type: 'UNTRACKED_CHANGE' } }),
    ).toBe(0);
  });

  it('PR이 main에 머지되면 작업 중 변경이 공식 상태로 승격되고 정리된다', async () => {
    const { project, feature } = await setupWithRepo();
    await pushToBranch(project.id, BRANCH, ['src/auth/login.ts']);

    const merged = await insertEvent(project.id, 'pull_request', {
      action: 'closed',
      pull_request: {
        number: 12,
        title: '관리자 권한 노출 조건 수정',
        merged: true,
        head: { sha: SHA, ref: BRANCH },
      },
    });
    await processGithubEvent(prisma, merged.id);

    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.implementationStatus).toBe('CHANGED');
    expect(after.verificationStatus).toBe('NEEDS_VERIFICATION');
    expect(after.lastStatusSource).toBe('GITHUB_WEBHOOK');
    // 작업 중 변경은 정리됐다
    expect(
      await prisma.featureBranchActivity.count({ where: { projectId: project.id } }),
    ).toBe(0);
    // PR 증거는 연결됐다
    expect(
      await prisma.featureEvidence.count({
        where: { featureNodeId: feature.id, type: 'PULL_REQUEST', ref: '12' },
      }),
    ).toBe(1);
  });

  it('PR이 머지 없이 닫히면 작업 중 변경만 정리되고 공식 상태는 불변', async () => {
    const { project, feature } = await setupWithRepo();
    await pushToBranch(project.id, BRANCH, ['src/auth/login.ts']);

    const closed = await insertEvent(project.id, 'pull_request', {
      action: 'closed',
      pull_request: { number: 13, merged: false, head: { sha: SHA, ref: BRANCH } },
    });
    await processGithubEvent(prisma, closed.id);

    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.implementationStatus).toBe('IMPLEMENTED');
    expect(after.verificationStatus).toBe('PASSED');
    expect(
      await prisma.featureBranchActivity.count({ where: { projectId: project.id } }),
    ).toBe(0);
  });

  it('브랜치가 삭제되면(delete 이벤트) 작업 중 변경이 정리된다', async () => {
    const { project } = await setupWithRepo();
    await pushToBranch(project.id, BRANCH, ['src/auth/login.ts']);
    expect(await prisma.featureBranchActivity.count()).toBe(1);

    const deleted = await insertEvent(project.id, 'delete', { ref: BRANCH, ref_type: 'branch' });
    await processGithubEvent(prisma, deleted.id);
    expect(await prisma.featureBranchActivity.count()).toBe(0);
  });

  it('PR 열림 이벤트는 브랜치 활동에 PR 번호/상태를 붙인다', async () => {
    const { project, feature } = await setupWithRepo();
    await pushToBranch(project.id, BRANCH, ['src/auth/login.ts']);
    const opened = await insertEvent(project.id, 'pull_request', {
      action: 'opened',
      pull_request: { number: 14, title: 'PR', head: { sha: SHA, ref: BRANCH } },
    });
    await processGithubEvent(prisma, opened.id);
    const activity = await prisma.featureBranchActivity.findUniqueOrThrow({
      where: { featureNodeId_branch: { featureNodeId: feature.id, branch: BRANCH } },
    });
    expect(activity.prNumber).toBe(14);
    expect(activity.prState).toBe('open');
  });

  it('feature 브랜치 CI 실패는 공식 상태가 아니라 브랜치 활동의 플래그로만 남는다', async () => {
    const { project, feature } = await setupWithRepo();
    await pushToBranch(project.id, BRANCH, ['src/auth/login.ts']);

    const check = await insertEvent(project.id, 'workflow_run', {
      action: 'completed',
      workflow_run: { name: 'CI', head_sha: SHA, conclusion: 'failure', head_branch: BRANCH },
    });
    await processGithubEvent(prisma, check.id);

    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.verificationStatus).toBe('PASSED'); // 공식 상태 불변
    const activity = await prisma.featureBranchActivity.findFirstOrThrow({
      where: { projectId: project.id, branch: BRANCH },
    });
    expect(activity.ciFailed).toBe(true);
    expect(
      await prisma.inboxItem.count({ where: { projectId: project.id, type: 'TEST_FAILURE' } }),
    ).toBe(0);
  });
});

// ---------- P3: 커밋 SHA 조인 중복 제거 ----------

describe('P3: 같은 작업이 3중으로 들어와도 하나의 작업 단위로 병합된다', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('MCP 기록의 commitShas가 push 커밋과 일치하면 untracked를 만들지 않고 같은 기능에 연결한다', async () => {
    const { project, feature } = await setup();
    // 1) MCP 기록 (증거 파일과 겹치지 않는 새 파일을 선언)
    await prisma.workUpdate.create({
      data: {
        projectId: project.id,
        source: 'MCP',
        summary: '점검 스크립트 추가',
        changedFiles: ['scripts/check.ts'],
        commitShas: [SHA],
        features: { create: [{ featureNodeId: feature.id }] },
      },
    });
    // 2) 같은 커밋의 push 이벤트
    const push = await insertEvent(project.id, 'push', {
      ref: 'refs/heads/main',
      commits: [
        { id: SHA, message: '점검 스크립트', added: ['scripts/check.ts'], modified: [], removed: [] },
      ],
    });
    await processGithubEvent(prisma, push.id);

    // 같은 작업 단위: 이미 기록된 파일이므로 untracked를 만들지 않는다
    expect(
      await prisma.inboxItem.count({ where: { projectId: project.id, type: 'UNTRACKED_CHANGE' } }),
    ).toBe(0);
    // SHA로 연결된 기능이 갱신되고 커밋 증거가 붙는다
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.implementationStatus).toBe('CHANGED');
    expect(
      await prisma.featureEvidence.count({
        where: { featureNodeId: feature.id, type: 'COMMIT', ref: SHA },
      }),
    ).toBe(1);

    // 3) 같은 커밋의 CI 이벤트도 같은 기능으로 조인된다
    const check = await insertEvent(project.id, 'check_run', {
      action: 'completed',
      check_run: { name: 'CI', head_sha: SHA, conclusion: 'success' },
    });
    await processGithubEvent(prisma, check.id);
    expect(
      (await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } }))
        .verificationStatus,
    ).toBe('PASSED');
    expect(
      await prisma.verificationRun.count({ where: { projectId: project.id, source: 'CI' } }),
    ).toBe(1);
  });
});
