import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ValidationError,
  createMcpToken,
  listMcpTokens,
  requireProjectAccess,
  revokeMcpToken,
  writeAudit,
} from '@vibetrack/tracker-core';
import { type ClaudeSetupDto, type McpTokenDto } from '@vibetrack/shared';
import { type AppContext } from '../app.js';
import { requireUser } from '../auth/session.js';

function toTokenDto(token: {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): McpTokenDto {
  return {
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}

function buildClaudeMd(): string {
  return `## VibeTrack 작업 규칙

이 프로젝트는 VibeTrack MCP로 상태를 추적한다. 반드시 지켜라.

1. 작업을 시작하면 먼저 \`get_project_context\`로 현재 프로젝트 맥락(기능 트리, 최근 작업,
   검증 필요 기능, 다음 우선 작업)을 조회한다.
2. 특정 기능을 건드릴 때는 \`get_feature_context\`로 그 기능의 파일/테스트/미해결 질문을 읽는다.
3. 작업을 마치기 전에 반드시 \`record_work_update\`를 호출한다.
   - 관련 featureIds, 작업 요약, 변경 파일 목록, 현재 git HEAD SHA를 넣는다.
   - 테스트를 돌렸다면 그 결과(passed/failed)를 반드시 기록한다.
   - 해결 못한 문제는 openQuestions에 반드시 기록한다.
4. 새 기능 추가, 기능 삭제(종료), 병합, 분리, 이동, 이름 변경이 필요하면
   \`propose_structure_change\`를 호출한다. 기능 트리를 직접 임의로 수정하지 않는다.
   제안은 사용자가 VibeTrack Inbox에서 승인해야 반영된다.
5. 무엇을 할지 모르겠으면 \`get_next_task\`로 현재 우선 작업 1개를 받아 수행한다.`;
}

function buildBootstrapPrompt(projectId: string): string {
  return `이 저장소 전체를 읽고 VibeTrack에 초기 기능 지도를 등록해라.

규칙:
- 파일 트리를 그대로 옮기지 마라. 사용자 관점의 기능 트리를 만들어라.
  (예: "로그인", "파일 업로드", "결과 요약" — "src/utils" 같은 폴더명 금지)
- 최상위는 3~6개 영역, 각 영역 아래에 구체 기능을 넣어라.
- 기능마다 증거를 연결해라: 관련 파일 경로, 라우트, API 엔드포인트, 테스트 파일.
- 이미 구현된 것으로 보이는 기능은 implementationStatus를 IMPLEMENTED 또는 PARTIAL로,
  아닌 것은 NOT_STARTED로 표시해라.
- 핵심 기능(제품이 성립하는 데 필수)은 isCore를 true로 표시해라.
- 다 만들면 vibetrack MCP의 bootstrap_project_map 도구를 projectId "${projectId}",
  현재 git HEAD SHA와 함께 호출해라.
- 등록 후 나에게 "VibeTrack 웹에서 기능 지도를 검토하고 승인하세요"라고 알려라.`;
}

export async function integrationRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { prisma, env, github } = opts.ctx;

  app.get('/api/projects/:projectId/mcp-tokens', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const tokens = await listMcpTokens(prisma, projectId);
    return { tokens: tokens.map(toTokenDto) };
  });

  app.post('/api/projects/:projectId/mcp-tokens', async (request, reply) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = z.object({ name: z.string().min(1).max(60).optional() }).parse(request.body ?? {});
    const { token, plaintext } = await createMcpToken(prisma, {
      projectId,
      userId: user.id,
      name: body.name,
    });
    // 평문은 이 응답에서 단 한 번만 반환된다. 로그에 남기지 않는다.
    return reply.status(201).send({ token: { ...toTokenDto(token), plaintext } });
  });

  app.post('/api/projects/:projectId/mcp-tokens/:tokenId/revoke', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, tokenId } = request.params as { projectId: string; tokenId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const token = await revokeMcpToken(prisma, { projectId, userId: user.id, tokenId });
    return { token: toTokenDto(token) };
  });

  // Claude Code 연결 안내: endpoint, 설정 예시, CLAUDE.md 규칙, bootstrap 프롬프트
  app.get('/api/projects/:projectId/claude-setup', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);

    const baseUrl = env.NODE_ENV === 'production' ? env.APP_URL : `http://localhost:${env.PORT}`;
    const mcpUrl = `${baseUrl}/mcp`;
    const tokens = await prisma.mcpToken.findMany({
      where: { projectId, revokedAt: null },
      orderBy: { lastUsedAt: { sort: 'desc', nulls: 'last' } },
    });
    const lastUsed = tokens.find((t) => t.lastUsedAt)?.lastUsedAt ?? null;
    // DEMO_MODE에서는 seed된 고정 데모 토큰을 예시에 바로 채워준다
    const { DEMO_MCP_TOKEN } = await import('../demo/seed.js');
    const hasDemoToken = env.DEMO_MODE && tokens.some((t) => t.name === 'demo');
    const tokenPlaceholder = hasDemoToken ? DEMO_MCP_TOKEN : 'vtk_발급받은_토큰';

    const setup: ClaudeSetupDto = {
      mcpUrl,
      projectId,
      hasActiveToken: tokens.length > 0,
      lastMcpActivityAt: lastUsed?.toISOString() ?? null,
      addCommandExample: `claude mcp add --transport http vibetrack ${mcpUrl} --header "Authorization: Bearer ${tokenPlaceholder}"`,
      mcpJsonExample: JSON.stringify(
        {
          mcpServers: {
            vibetrack: {
              type: 'http',
              url: mcpUrl,
              headers: { Authorization: `Bearer ${tokenPlaceholder}` },
            },
          },
        },
        null,
        2,
      ),
      claudeMdExample: buildClaudeMd(),
      bootstrapPrompt: buildBootstrapPrompt(projectId),
    };
    return { setup };
  });

  // GitHub 연동 상태
  app.get('/api/github/status', async () => ({
    appConfigured: github.isConfigured(),
    oauthConfigured: github.hasOAuth(),
    webhookConfigured: Boolean(github.webhookSecret()),
    demoMode: env.DEMO_MODE,
  }));

  // 사용자 설치 기준 연결 가능한 저장소 목록
  app.get('/api/github/repos', async (request) => {
    const user = await requireUser(prisma, request);
    if (env.DEMO_MODE && !github.isConfigured()) {
      return {
        repos: [
          { installationId: null, fullName: 'demo/review-insight', owner: 'demo', name: 'review-insight', defaultBranch: 'main' },
        ],
        demo: true,
      };
    }
    if (!github.isConfigured()) {
      throw new ValidationError('GitHub App이 설정되지 않았습니다. docs/github-app-setup.md를 참조하세요.');
    }
    const installations = await prisma.githubInstallation.findMany({
      where: { userId: user.id },
    });
    const repos = [];
    for (const inst of installations) {
      const list = await github.listInstallationRepos(Number(inst.installationId));
      repos.push(
        ...list.map((r) => ({
          installationId: inst.id,
          fullName: r.fullName,
          owner: r.owner,
          name: r.name,
          defaultBranch: r.defaultBranch,
        })),
      );
    }
    return { repos, demo: false };
  });

  // 저장소를 프로젝트에 연결
  app.post('/api/projects/:projectId/github/connect', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = z
      .object({
        owner: z.string().min(1),
        name: z.string().min(1),
        defaultBranch: z.string().min(1).default('main'),
        installationId: z.string().nullable().optional(),
      })
      .parse(request.body);
    const repository = await prisma.repository.upsert({
      where: { projectId },
      update: {
        owner: body.owner,
        name: body.name,
        fullName: `${body.owner}/${body.name}`,
        defaultBranch: body.defaultBranch,
        githubInstallationId: body.installationId ?? null,
      },
      create: {
        projectId,
        owner: body.owner,
        name: body.name,
        fullName: `${body.owner}/${body.name}`,
        defaultBranch: body.defaultBranch,
        githubInstallationId: body.installationId ?? null,
      },
    });
    await writeAudit(prisma, {
      projectId,
      userId: user.id,
      action: 'repository.connected',
      entityType: 'Repository',
      entityId: repository.id,
      detail: { fullName: repository.fullName, defaultBranch: repository.defaultBranch },
    });
    return {
      repository: {
        id: repository.id,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        connected: true,
      },
    };
  });
}
