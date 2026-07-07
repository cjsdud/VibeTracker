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

function buildHistoryImportPrompt(projectId: string): string {
  return `지난 Claude Code 세션 기록을 VibeTrack 프로젝트 "${projectId}"에 소급 등록해라.

준비:
- 먼저 get_project_context로 승인된 기능 트리와 기능 ID를 확인해라.
- 이 작업은 한 번만 실행해야 한다. recentWork에 이미 과거 날짜의 소급 기록이 보이면
  중단하고 사용자에게 알려라.

세션 로그 위치:
- ~/.claude/projects/ 아래에 현재 프로젝트 경로를 변환한 폴더가 있다
  (경로 구분자 '/'를 '-'로 바꾼 이름).
- 그 안의 *.jsonl 파일 하나가 세션 하나다. 수정 시각이 오래된 것부터 처리해라.
- 파일이 크면 전체를 읽지 말고 사용자 메시지와 마지막 요약 위주로 훑어라.

각 세션에서 추출할 것:
- 실제로 수행한 작업 요약 (요청과 결과 중심, 1~3문장)
- 변경한 파일 경로들
- 테스트 실행 결과 (있으면 PASSED/FAILED)
- 아직도 해결되지 않은 질문·미완성 항목만
- 세션 마지막 타임스탬프 → occurredAt (ISO 8601)
- git log에서 그 시점 커밋을 찾을 수 있으면 gitHeadSha로 포함

기록 규칙:
- 의미 있는 작업 세션만 기록해라. 질문/조회만 한 세션은 건너뛴다.
- 세션마다 record_work_update를 호출하되 반드시 occurredAt을 넣어라.
  occurredAt이 있으면 타임라인/증거만 기록되고 현재 기능 상태는 바뀌지 않는다.
- featureIds는 기능 트리에서 가장 맞는 기능들을 골라 반드시 지정해라.
- 이미 해결된 질문은 openQuestions에 넣지 마라.
- 끝나면 몇 개 세션을 기록했고 몇 개를 건너뛰었는지 보고해라.`;
}

function buildBootstrapPrompt(projectId: string): string {
  return `이 저장소 전체를 읽고 VibeTrack에 기능 지도를 등록해라.

이 지도는 개발을 모르는 사람이 읽는다. 목적은 프로젝트 주인이 지도만 보고
"무엇이 만들어졌고, 무엇이 확인 안 됐고, 무엇이 남았는지"를 파악하는 것이다.

이름 규칙 (가장 중요):
- 모든 이름은 "사용자가 하는 일" 또는 "사용자 눈에 보이는 것"으로 지어라.
- 기술 용어 금지: API, MCP, webhook, 엔드포인트, DB, 스키마, 큐, 미들웨어,
  폴더/파일명. 기술 이름이 아니라 그 기술이 사용자에게 해주는 일을 써라.
  나쁜 예 → 좋은 예:
  - "MCP 엔드포인트" → "Claude Code에서 프로젝트 상태 읽고 쓰기"
  - "Webhook 수신과 서명 검증" → "GitHub 활동 자동 반영"
  - "사용자 접근" → "시작하기와 로그인"
- 사용자에게 직접 보이지 않는 내부 구성요소(큐, 캐시, 마이그레이션 등)는
  기능으로 만들지 마라. 그것이 지탱하는 사용자 기능의 evidence로만 연결해라.

구성 규칙:
- 최상위 영역은 3~6개, 사용자가 서비스를 접하는 순서대로 배치해라
  (시작하기 → 핵심 기능 → 부가 기능 순). 영역 이름도 행동 중심으로.
- 각 영역 아래 구체 기능 2~7개, 전체 15~30개가 적당하다.
- 모든 기능에 description 한 줄을 반드시 써라: "누가 무엇을 할 수 있다" 형식.

증거와 상태:
- 기능마다 evidence를 연결해라: 파일 경로, 라우트, API 엔드포인트, 테스트.
  (기술 정보는 이름이 아니라 여기에 넣는 것이다)
- 구현이 끝나 보이면 implementationStatus를 IMPLEMENTED, 일부만 있으면 PARTIAL,
  아직이면 NOT_STARTED로 표시해라.
- 제품이 성립하는 데 필수인 기능은 isCore를 true로 표시해라.

등록 절차:
- 등록 전에 각 이름을 읽고 자문해라: "개발을 모르는 사람이 이 이름만 보고
  무슨 기능인지 알겠는가?" 하나라도 아니면 고쳐라.
- 다 만들면 vibetrack MCP의 bootstrap_project_map 도구를 projectId "${projectId}",
  현재 git HEAD SHA와 함께 호출해라.
- 결과에 qualityWarnings가 있으면 지적된 이름/설명을 고쳐 같은 도구를 다시
  호출해라 (초안이 새 초안으로 교체된다).
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
      historyImportPrompt: buildHistoryImportPrompt(projectId),
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
          {
            installationId: null,
            fullName: 'demo/review-insight',
            owner: 'demo',
            name: 'review-insight',
            defaultBranch: 'main',
          },
        ],
        demo: true,
      };
    }
    if (!github.isConfigured()) {
      throw new ValidationError(
        'GitHub App이 설정되지 않았습니다. docs/github-app-setup.md를 참조하세요.',
      );
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

    // GitHub App이 설정된 환경에서는 사용자가 실제로 접근 가능한 저장소만 연결할 수 있다.
    // (webhook이 fullName으로 프로젝트를 찾으므로, 임의 저장소 연결은 타인 이벤트 수신으로 이어진다)
    if (github.isConfigured()) {
      const installation = body.installationId
        ? await prisma.githubInstallation.findFirst({
            where: { id: body.installationId, userId: user.id },
          })
        : null;
      if (!installation) {
        throw new ValidationError(
          '본인 계정의 GitHub App 설치를 통해서만 저장소를 연결할 수 있습니다.',
        );
      }
      const accessible = await github.listInstallationRepos(Number(installation.installationId));
      if (!accessible.some((r) => r.fullName === `${body.owner}/${body.name}`)) {
        throw new ValidationError('해당 저장소에 대한 접근 권한을 확인할 수 없습니다.');
      }
    }

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
