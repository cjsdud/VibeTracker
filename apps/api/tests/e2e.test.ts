import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FeatureNodeDto, InboxItemDto } from '@vibetrack/shared';
import { buildTestApp, createTestDb, demoLogin, resetDb } from './helpers.js';

/**
 * End-to-end happy path (스펙 13번 흐름 그대로):
 * 데모 로그인 → 프로젝트 생성 → MCP 토큰 발급 → 실제 MCP 클라이언트로
 * bootstrap_project_map → 웹 API로 기능 지도 승인 → record_work_update →
 * propose_structure_change → Inbox 승인 → 기능 트리 변경 확인
 */
describe('E2E happy path', () => {
  const prisma = createTestDb();
  let app: FastifyInstance;
  let baseUrl: string;
  let cookie: string;
  let projectId: string;
  let mcpToken: string;
  let mcp: Client;

  beforeAll(async () => {
    await resetDb(prisma);
    app = await buildTestApp(prisma);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('주소를 얻지 못했습니다');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await mcp?.close().catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it('1) 데모 사용자 로그인', async () => {
    cookie = await demoLogin(app);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect((me.json() as { user: { isDemo: boolean } }).user.isDemo).toBe(true);
  });

  it('2) 프로젝트 생성', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie },
      payload: { name: '새 사이드 프로젝트', goal: '테스트용 프로젝트' },
    });
    expect(response.statusCode).toBe(201);
    projectId = (response.json() as { project: { id: string } }).project.id;
  });

  it('3) MCP 토큰 발급 후 실제 MCP 클라이언트로 bootstrap_project_map 실행', async () => {
    const tokenResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/mcp-tokens`,
      headers: { cookie },
      payload: { name: 'e2e' },
    });
    expect(tokenResponse.statusCode).toBe(201);
    mcpToken = (tokenResponse.json() as { token: { plaintext: string } }).token.plaintext;
    expect(mcpToken.startsWith('vtk_')).toBe(true);

    mcp = new Client({ name: 'claude-code-e2e', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } },
    });
    await mcp.connect(transport);

    const result = await mcp.callTool({
      name: 'bootstrap_project_map',
      arguments: {
        projectId,
        baseCommitSha: 'e2e0000e2e0000e2e0000e2e0000e2e0000e2e00',
        projectGoal: '사이드 프로젝트 목표',
        features: [
          {
            name: '사용자 계정',
            isCore: true,
            children: [
              {
                name: '로그인',
                isCore: true,
                implementationStatus: 'IMPLEMENTED',
                evidence: { files: ['src/auth/login.ts'], tests: ['src/auth/login.test.ts'] },
              },
            ],
          },
          { name: '리포트', children: [{ name: '주간 요약' }] },
        ],
      },
    });
    expect(result.isError).not.toBe(true);

    // 무조건 DRAFT + Inbox 검토 항목
    const tree = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features`,
      headers: { cookie },
    });
    const nodes = (tree.json() as { tree: FeatureNodeDto[] }).tree;
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.lifecycle === 'DRAFT')).toBe(true);
  });

  it('4) 웹에서 기능 지도 승인 → ACTIVE + 트리 버전 1', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/feature-map/approve`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { version: number }).version).toBe(1);

    const tree = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features`,
      headers: { cookie },
    });
    const nodes = (tree.json() as { tree: FeatureNodeDto[] }).tree;
    expect(nodes.every((n) => n.lifecycle === 'ACTIVE')).toBe(true);
  });

  it('5) record_work_update가 타임라인과 검증 상태를 갱신한다', async () => {
    const tree = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features`,
      headers: { cookie },
    });
    const nodes = (tree.json() as { tree: FeatureNodeDto[] }).tree;
    const login = nodes[0]?.children[0];
    expect(login?.name).toBe('로그인');

    const result = await mcp.callTool({
      name: 'record_work_update',
      arguments: {
        projectId,
        featureIds: [login!.id],
        summary: '로그인 rate limit 추가',
        changedFiles: ['src/auth/login.ts'],
        gitHeadSha: 'e2e1111e2e1111e2e1111e2e1111e2e1111e2e11',
        tests: { status: 'PASSED', passed: 5, failed: 0 },
        openQuestions: ['rate limit 기준을 IP로 할까 계정으로 할까?'],
      },
    });
    expect(result.isError).not.toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features/${login!.id}`,
      headers: { cookie },
    });
    const feature = (
      detail.json() as {
        feature: {
          node: { verificationStatus: string };
          workUpdates: unknown[];
          openQuestions: unknown[];
        };
      }
    ).feature;
    expect(feature.node.verificationStatus).toBe('PASSED');
    expect(feature.workUpdates).toHaveLength(1);
    expect(feature.openQuestions).toHaveLength(1);
  });

  it('6) propose_structure_change는 트리를 바꾸지 않고 Inbox에 쌓인다', async () => {
    const result = await mcp.callTool({
      name: 'propose_structure_change',
      arguments: {
        projectId,
        type: 'CREATE',
        reason: '알림 채널이 필요하다',
        proposedNode: { name: '알림', isCore: false },
      },
    });
    expect(result.isError).not.toBe(true);

    const tree = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features`,
      headers: { cookie },
    });
    const names = (tree.json() as { tree: FeatureNodeDto[] }).tree.map((n) => n.name);
    expect(names).not.toContain('알림'); // 자동 반영 금지

    const inbox = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/inbox`,
      headers: { cookie },
    });
    const items = (inbox.json() as { items: InboxItemDto[] }).items;
    const proposalItem = items.find((i) => i.type === 'STRUCTURE_PROPOSAL');
    expect(proposalItem?.changeProposal?.status).toBe('PENDING');
  });

  it('7-8) Inbox에서 승인하면 기능 트리가 변경된다', async () => {
    const inbox = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/inbox`,
      headers: { cookie },
    });
    const items = (inbox.json() as { items: InboxItemDto[] }).items;
    const proposalId = items.find((i) => i.type === 'STRUCTURE_PROPOSAL')?.changeProposal?.id;
    expect(proposalId).toBeTruthy();

    const approve = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/proposals/${proposalId}/approve`,
      headers: { cookie },
    });
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { version: number }).version).toBe(2);

    const tree = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features`,
      headers: { cookie },
    });
    const names = (tree.json() as { tree: FeatureNodeDto[] }).tree.map((n) => n.name);
    expect(names).toContain('알림');

    // Inbox 정리 확인
    const inboxAfter = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/inbox`,
      headers: { cookie },
    });
    const openProposals = (inboxAfter.json() as { items: InboxItemDto[] }).items.filter(
      (i) => i.type === 'STRUCTURE_PROPOSAL',
    );
    expect(openProposals).toHaveLength(0);

    // get_next_task도 정상 응답
    const nextTask = await mcp.callTool({
      name: 'get_next_task',
      arguments: { projectId },
    });
    expect(nextTask.isError).not.toBe(true);
  });

  it('9) 승인된 지도 위에 새 지도를 등록하면 교체 초안이 만들어진다 (기존 지도 무변경)', async () => {
    const result = await mcp.callTool({
      name: 'bootstrap_project_map',
      arguments: {
        projectId,
        baseCommitSha: 'e2e2222e2e2222e2e2222e2e2222e2e2222e2e22',
        features: [
          {
            name: '재설계된 계정',
            isCore: true,
            children: [{ name: '통합 로그인', implementationStatus: 'IMPLEMENTED' }],
          },
          { name: '재설계된 리포트' },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(
      (result as { content: { text: string }[] }).content[0]!.text,
    ) as { replacesActiveMap: boolean; draftCount: number };
    expect(parsed.replacesActiveMap).toBe(true);
    expect(parsed.draftCount).toBe(3);

    // 기존 ACTIVE 지도는 승인 전까지 그대로다
    const tree = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features`,
      headers: { cookie },
    });
    const nodes = (tree.json() as { tree: FeatureNodeDto[] }).tree;
    const actives = nodes.filter((n) => n.lifecycle === 'ACTIVE').map((n) => n.name);
    expect(actives).toContain('사용자 계정');
    expect(actives).toContain('알림');
    const drafts = nodes.filter((n) => n.lifecycle === 'DRAFT').map((n) => n.name);
    expect(drafts.sort()).toEqual(['재설계된 계정', '재설계된 리포트']);
  });

  it('10) 교체 승인 시 기존 지도는 종료되고 새 지도가 활성화되며 기록은 보존된다', async () => {
    const approve = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/feature-map/approve`,
      headers: { cookie },
    });
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { retiredCount: number }).retiredCount).toBeGreaterThan(0);

    const tree = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features`,
      headers: { cookie },
    });
    const nodes = (tree.json() as { tree: FeatureNodeDto[] }).tree;
    const byLifecycle = (lc: string) => nodes.filter((n) => n.lifecycle === lc).map((n) => n.name);
    expect(byLifecycle('ACTIVE').sort()).toEqual(['재설계된 계정', '재설계된 리포트']);
    expect(byLifecycle('RETIRED')).toContain('사용자 계정');
    expect(byLifecycle('DRAFT')).toHaveLength(0);

    // 종료된 옛 '로그인' 기능의 작업 기록은 상세에서 그대로 조회된다
    const retiredLogin = nodes
      .flatMap(function flat(n: FeatureNodeDto): FeatureNodeDto[] {
        return [n, ...n.children.flatMap(flat)];
      })
      .find((n) => n.name === '로그인');
    expect(retiredLogin?.lifecycle).toBe('RETIRED');
    const detail = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/features/${retiredLogin!.id}`,
      headers: { cookie },
    });
    const feature = (detail.json() as { feature: { workUpdates: unknown[] } }).feature;
    expect(feature.workUpdates.length).toBeGreaterThan(0);
  });
});
