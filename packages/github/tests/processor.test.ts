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

  it('프로젝트에 매핑되지 않은 이벤트는 SKIPPED 처리한다', async () => {
    const event = await insertEvent(null, 'push', { commits: [] });
    await processGithubEvent(prisma, event.id);
    expect((await prisma.githubEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'SKIPPED',
    );
  });
});
