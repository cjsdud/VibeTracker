import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { DomainError, type PrismaClient } from '@vibetrack/tracker-core';
import { GithubAppAdapter } from '@vibetrack/github';
import { ZodError } from 'zod';
import { type Env } from './env.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { featureRoutes } from './routes/features.js';
import { inboxRoutes } from './routes/inbox.js';
import { activityRoutes } from './routes/activity.js';
import { integrationRoutes } from './routes/integrations.js';
import { demoRoutes } from './routes/demo.js';
import { mcpRoutes } from './mcp/route.js';
import { githubWebhookRoutes } from './github/webhook.js';

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
}

export interface AppContext extends AppDeps {
  github: GithubAppAdapter;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.NODE_ENV === 'test' ? 'warn' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,
  });

  const ctx: AppContext = {
    ...deps,
    github: new GithubAppAdapter({
      appId: deps.env.GITHUB_APP_ID,
      privateKey: deps.env.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: deps.env.GITHUB_WEBHOOK_SECRET,
      clientId: deps.env.GITHUB_CLIENT_ID,
      clientSecret: deps.env.GITHUB_CLIENT_SECRET,
    }),
  };

  await app.register(cookie, { secret: deps.env.SESSION_SECRET });

  // 일관된 오류 응답 형식: { error: { code, message } }
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.httpStatus).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
        },
      });
    }
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({
        error: {
          code: fastifyError.code ?? 'BAD_REQUEST',
          message: fastifyError.message ?? '잘못된 요청입니다.',
        },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' },
    });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes, { ctx });
  await app.register(projectRoutes, { ctx });
  await app.register(featureRoutes, { ctx });
  await app.register(inboxRoutes, { ctx });
  await app.register(activityRoutes, { ctx });
  await app.register(integrationRoutes, { ctx });
  await app.register(mcpRoutes, { ctx });
  await app.register(githubWebhookRoutes, { ctx });
  if (deps.env.DEMO_MODE) {
    await app.register(demoRoutes, { ctx });
  }

  // 프로덕션: 웹 빌드 정적 서빙 + SPA fallback
  if (deps.env.NODE_ENV === 'production') {
    const { default: fastifyStatic } = await import('@fastify/static');
    const webDist = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../web/dist',
    );
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/mcp')) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' },
        });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
