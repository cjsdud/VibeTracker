import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError } from 'zod';
import {
  bootstrapProjectMapInput,
  getFeatureContextInput,
  getNextTaskInput,
  getProjectContextInput,
  proposeStructureChangeBase,
  proposeStructureChangeInput,
  recordWorkUpdateInput,
} from '@vibetrack/shared';
import {
  DomainError,
  bootstrapProjectMap,
  createProposal,
  getFeatureContext,
  getNextTask,
  getProjectContext,
  recordWorkUpdate,
  type PrismaClient,
} from '@vibetrack/tracker-core';

export interface McpServerContext {
  prisma: PrismaClient;
  /** 인증된 토큰이 속한 프로젝트. 모든 도구는 이 범위를 벗어날 수 없다. */
  projectId: string;
}

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 1) }],
  };
}

function errorResult(error: unknown) {
  let message: string;
  if (error instanceof DomainError) {
    message = error.message;
  } else if (error instanceof ZodError) {
    // 에이전트가 스스로 고칠 수 있도록 필드별 검증 메시지를 그대로 돌려준다
    message = error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
  } else {
    console.error('[mcp] tool error', error);
    message = '요청을 처리하지 못했습니다. 입력을 확인하고 다시 시도하세요.';
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/** 도구 입력의 projectId가 토큰 범위와 일치하는지 확인한다. */
function assertProjectScope(ctx: McpServerContext, projectId: string): void {
  if (projectId !== ctx.projectId) {
    throw new DomainError(
      'FORBIDDEN',
      `이 연결 토큰은 프로젝트 ${ctx.projectId} 범위입니다. 입력한 projectId를 확인하세요.`,
      403,
    );
  }
}

/**
 * 요청(연결)마다 새로 생성되는 MCP 서버.
 * Streamable HTTP stateless 모드에서 transport와 1:1로 붙는다.
 */
export function buildMcpServer(ctx: McpServerContext): McpServer {
  const server = new McpServer({ name: 'vibetrack', version: '0.1.0' });

  server.registerTool(
    'get_project_context',
    {
      title: '프로젝트 맥락 조회',
      description:
        '현재 프로젝트의 압축된 맥락을 반환한다: 목표, 기능 트리 요약(기능 ID 포함), 최근 작업, 검증 필요 기능, 미해결 질문, 승인 대기 제안, 다음 우선 작업. 작업을 시작할 때 가장 먼저 호출하라.',
      inputSchema: getProjectContextInput.shape,
    },
    async (args) => {
      try {
        const input = getProjectContextInput.parse(args);
        assertProjectScope(ctx, input.projectId);
        return textResult(
          await getProjectContext(ctx.prisma, input.projectId, input.focusFeatureIds),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_feature_context',
    {
      title: '기능 상세 맥락 조회',
      description:
        '특정 기능의 상세 맥락을 반환한다: 3축 상태, 연결 파일/라우트/API/테스트, 최근 작업, 미해결 질문, 관련 커밋, 검증 실행 기록.',
      inputSchema: getFeatureContextInput.shape,
    },
    async (args) => {
      try {
        const input = getFeatureContextInput.parse(args);
        assertProjectScope(ctx, input.projectId);
        return textResult(await getFeatureContext(ctx.prisma, input.projectId, input.featureId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'bootstrap_project_map',
    {
      title: '초기 기능 지도 등록',
      description:
        '저장소 분석 후 초기 기능 지도 초안을 등록한다. 파일 트리가 아니라 사용자 관점의 기능 트리를 등록하라. 기능마다 파일/라우트/API/테스트 증거를 연결하라. 결과는 무조건 DRAFT(승인 대기)이며 사용자가 웹에서 승인해야 활성화된다.',
      inputSchema: bootstrapProjectMapInput.shape,
    },
    async (args) => {
      try {
        const input = bootstrapProjectMapInput.parse(args);
        assertProjectScope(ctx, input.projectId);
        const result = await bootstrapProjectMap(ctx.prisma, { input });
        return textResult({
          status: 'DRAFT_CREATED',
          draftCount: result.draftCount,
          message:
            '기능 지도 초안이 등록되었습니다. 사용자가 VibeTrack 웹에서 검토·승인해야 활성화됩니다. 사용자에게 승인을 요청하세요.',
          tree: result.tree,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'record_work_update',
    {
      title: '작업 결과 기록',
      description:
        '작업을 마치기 전에 호출해 결과를 기록한다. 관련 기능의 타임라인/증거/검증 상태가 자동 갱신된다. 테스트 결과와 미해결 질문을 반드시 포함하라. 기능 구조를 바꾸는 요청은 이 도구가 아니라 propose_structure_change를 사용하라.',
      inputSchema: recordWorkUpdateInput.shape,
    },
    async (args) => {
      try {
        const input = recordWorkUpdateInput.parse(args);
        assertProjectScope(ctx, input.projectId);
        const result = await recordWorkUpdate(ctx.prisma, { input });
        return textResult({
          workUpdateId: result.workUpdate.id,
          linkedFeatures: result.linkedFeatures,
          verificationApplied: result.verificationApplied,
          untracked: result.untracked,
          message: result.untracked
            ? '어떤 기능과도 연결되지 않아 Inbox에 추적되지 않은 변경으로 등록했습니다. 가능하면 featureIds를 지정하거나 새 기능이면 propose_structure_change를 사용하세요.'
            : '작업이 기록되었습니다.',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'propose_structure_change',
    {
      title: '기능 구조 변경 제안',
      description:
        '새 기능 생성, 기능 종료, 이름 변경, 이동, 병합, 분리, 대체를 제안한다. 기능 트리를 직접 수정하지 않으며, 항상 승인 대기(PENDING) 제안이 만들어져 사용자가 Inbox에서 승인해야 반영된다.',
      inputSchema: proposeStructureChangeBase.shape,
    },
    async (args) => {
      try {
        const input = proposeStructureChangeInput.parse(args);
        assertProjectScope(ctx, input.projectId);
        const proposal = await createProposal(ctx.prisma, { input });
        return textResult({
          proposalId: proposal.id,
          status: proposal.status,
          title: proposal.title,
          message:
            '구조 변경 제안이 승인 대기로 등록되었습니다. 사용자가 VibeTrack Inbox에서 승인해야 기능 트리에 반영됩니다.',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_next_task',
    {
      title: '다음 우선 작업 조회',
      description:
        '규칙 기반 우선순위(테스트 실패 > 핵심 기능 검증 필요 > 승인 대기 > 추적 안 된 변경 > 미해결 질문 > 미구현 핵심 기능)로 지금 가장 우선인 작업 1개와 실행 지시문을 반환한다.',
      inputSchema: getNextTaskInput.shape,
    },
    async (args) => {
      try {
        const input = getNextTaskInput.parse(args);
        assertProjectScope(ctx, input.projectId);
        return textResult(await getNextTask(ctx.prisma, input.projectId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
