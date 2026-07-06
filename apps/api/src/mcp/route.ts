import { type FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from '@vibetrack/mcp';
import { authenticateMcpToken, DomainError } from '@vibetrack/tracker-core';
import { type AppContext } from '../app.js';

/**
 * Remote MCP endpoint (Streamable HTTP, stateless 모드).
 *
 * - 요청마다 McpServer + transport를 새로 만들고 세션을 유지하지 않는다
 *   (sessionIdGenerator: undefined). 수평 확장과 재시작에 안전하다.
 * - 인증: Authorization: Bearer vtk_... 프로젝트 범위 토큰.
 *   authenticateMcpToken이 유일한 진입점이므로 이후 OAuth로 교체 가능하다.
 */
export async function mcpRoutes(app: FastifyInstance, opts: { ctx: AppContext }): Promise<void> {
  const { prisma } = opts.ctx;

  app.post('/mcp', async (request, reply) => {
    let projectId: string;
    try {
      const header = request.headers.authorization;
      const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      const auth = await authenticateMcpToken(prisma, bearer);
      projectId = auth.project.id;
    } catch (error) {
      const message = error instanceof DomainError ? error.message : 'MCP 인증에 실패했습니다.';
      return reply.status(error instanceof DomainError ? error.httpStatus : 401).send({
        jsonrpc: '2.0',
        error: { code: -32001, message },
        id: null,
      });
    }

    const server = buildMcpServer({ prisma, projectId });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    reply.hijack();
    // stateless 모드: 응답이 끝나면(정상/오류/클라이언트 중단 모두) 인스턴스를 정리한다.
    // close 리스너는 handleRequest 이전에 등록해야 조기 연결 종료를 잡을 수 있다.
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void transport.close();
      void server.close();
    };
    reply.raw.on('close', cleanup);
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      cleanup();
    } catch (error) {
      request.log.error({ err: error }, 'MCP 요청 처리 실패');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: '서버 내부 오류' },
            id: null,
          }),
        );
      } else {
        reply.raw.end();
      }
      cleanup();
    }
  });

  // stateless 모드에서는 GET(SSE 스트림)과 DELETE(세션 종료)를 지원하지 않는다
  const methodNotAllowed = async (
    _request: unknown,
    reply: { status: (c: number) => { send: (b: unknown) => unknown } },
  ) =>
    reply.status(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. POST /mcp를 사용하세요.' },
      id: null,
    });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
