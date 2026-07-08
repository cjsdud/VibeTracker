import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPrismaClient, type PrismaClient } from '@vibetrack/tracker-core';
import { buildMcpServer } from '../src/server.js';

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

async function setupProject() {
  const user = await prisma.user.create({ data: { name: '테스터' } });
  const project = await prisma.project.create({
    data: { userId: user.id, name: 'MCP 테스트', goal: '목표' },
  });
  return { user, project };
}

/** 실제 MCP client-server 쌍으로 도구를 호출한다. */
async function connectClient(projectId: string): Promise<Client> {
  const server = buildMcpServer({ prisma, projectId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function parseText(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('MCP tools', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('6개 도구가 노출된다', async () => {
    const { project } = await setupProject();
    const client = await connectClient(project.id);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'bootstrap_project_map',
      'get_feature_context',
      'get_next_task',
      'get_project_context',
      'propose_structure_change',
      'record_work_update',
    ]);
    await client.close();
  });

  it('잘못된 입력은 검증 오류를 낸다 (record_work_update: summary 누락)', async () => {
    const { project } = await setupProject();
    const client = await connectClient(project.id);
    const result = await client.callTool({
      name: 'record_work_update',
      arguments: { projectId: project.id },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it('propose_structure_change: 타입별 필수 조합을 검증한다', async () => {
    const { project } = await setupProject();
    const client = await connectClient(project.id);
    // RENAME인데 newName 없음
    const bad = await client.callTool({
      name: 'propose_structure_change',
      arguments: {
        projectId: project.id,
        type: 'RENAME',
        targetFeatureIds: ['x'],
        reason: '이유',
      },
    });
    expect(bad.isError).toBe(true);
    await client.close();
  });

  it('토큰 범위 밖의 projectId는 거부된다', async () => {
    const { project } = await setupProject();
    const client = await connectClient(project.id);
    const result = await client.callTool({
      name: 'get_next_task',
      arguments: { projectId: 'other-project' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(parseText(result))).toContain('범위');
    await client.close();
  });

  it('bootstrap → context → record → propose 흐름이 실제로 동작한다', async () => {
    const { project } = await setupProject();
    const client = await connectClient(project.id);

    const boot = await client.callTool({
      name: 'bootstrap_project_map',
      arguments: {
        projectId: project.id,
        baseCommitSha: 'abc1234',
        features: [
          {
            name: '로그인',
            isCore: true,
            implementationStatus: 'IMPLEMENTED',
            evidence: { files: ['src/login.ts'] },
          },
        ],
      },
    });
    expect(boot.isError).not.toBe(true);
    const bootData = parseText(boot);
    expect(bootData.status).toBe('DRAFT_CREATED');

    const context = parseText(
      await client.callTool({
        name: 'get_project_context',
        arguments: { projectId: project.id },
      }),
    );
    expect(context.featureTreeSummary).toContain('로그인');
    // get_project_context는 복귀 브리핑 구조를 반환한다 — 추천(nextTask)은 없다
    const briefing = context.briefing as {
      briefingText: string;
      needsVerification: unknown[];
      recentWork: { basis: string };
    };
    expect(briefing.briefingText).toContain('복귀 브리핑');
    expect('nextTask' in context).toBe(false);

    // DRAFT 상태에서도 기록은 가능하다
    const node = await prisma.featureNode.findFirstOrThrow({
      where: { projectId: project.id, name: '로그인' },
    });
    const record = await client.callTool({
      name: 'record_work_update',
      arguments: {
        projectId: project.id,
        featureIds: [node.id],
        summary: '로그인 개선',
        changedFiles: ['src/login.ts'],
        tests: { status: 'PASSED', passed: 3, failed: 0 },
      },
    });
    expect(record.isError).not.toBe(true);

    const propose = parseText(
      await client.callTool({
        name: 'propose_structure_change',
        arguments: {
          projectId: project.id,
          type: 'CREATE',
          reason: '회원가입 분리 필요',
          proposedNode: { name: '회원가입' },
        },
      }),
    );
    expect(propose.status).toBe('PENDING');
    // 트리는 그대로 (제안만 생성)
    expect(await prisma.featureNode.count({ where: { projectId: project.id } })).toBe(1);

    const featureContext = parseText(
      await client.callTool({
        name: 'get_feature_context',
        arguments: { projectId: project.id, featureId: node.id },
      }),
    );
    expect((featureContext.node as { name: string }).name).toBe('로그인');
    expect((featureContext.workUpdates as unknown[]).length).toBe(1);

    await client.close();
  });
});
