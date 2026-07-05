import { type FastifyInstance } from 'fastify';
import { verifyWebhookSignature } from '@vibetrack/github';
import { enqueueJob, type Prisma } from '@vibetrack/tracker-core';
import { type AppContext } from '../app.js';

interface WebhookRepositoryPayload {
  repository?: { full_name?: string };
}

/**
 * GitHub webhook 수신.
 * 1) raw body로 서명 검증 → 2) delivery ID 중복 방지 → 3) 빠르게 저장 →
 * 4) Job enqueue 후 즉시 202. 실제 처리는 worker가 비동기로 한다.
 */
export async function githubWebhookRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { prisma, github } = opts.ctx;

  await app.register(async (scope) => {
    // 이 스코프에서만 raw body를 유지한다 (서명은 원문 기준으로 검증해야 한다)
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );

    scope.post('/api/github/webhook', async (request, reply) => {
      const secret = github.webhookSecret();
      if (!secret) {
        return reply.status(503).send({
          error: {
            code: 'WEBHOOK_NOT_CONFIGURED',
            message: 'GITHUB_WEBHOOK_SECRET이 설정되지 않았습니다.',
          },
        });
      }

      const rawBody = request.body as Buffer;
      const valid = verifyWebhookSignature({
        secret,
        rawBody,
        signatureHeader: request.headers['x-hub-signature-256'] as string | undefined,
      });
      if (!valid) {
        return reply.status(401).send({
          error: { code: 'INVALID_SIGNATURE', message: 'webhook 서명이 유효하지 않습니다.' },
        });
      }

      const deliveryId = request.headers['x-github-delivery'] as string | undefined;
      const eventType = request.headers['x-github-event'] as string | undefined;
      if (!deliveryId || !eventType) {
        return reply.status(400).send({
          error: { code: 'BAD_WEBHOOK', message: 'delivery ID 또는 event 헤더가 없습니다.' },
        });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      } catch {
        return reply.status(400).send({
          error: { code: 'BAD_JSON', message: 'webhook 본문이 올바른 JSON이 아닙니다.' },
        });
      }

      // 저장소 → 프로젝트 매핑
      const fullName = (payload as WebhookRepositoryPayload).repository?.full_name;
      const repository = fullName
        ? await prisma.repository.findFirst({ where: { fullName } })
        : null;

      // delivery ID 중복 방지 (GitHub 재전송 대응)
      try {
        const event = await prisma.githubEvent.create({
          data: {
            deliveryId,
            eventType,
            action: typeof payload.action === 'string' ? payload.action : null,
            payload: payload as Prisma.InputJsonValue,
            projectId: repository?.projectId ?? null,
          },
        });
        await enqueueJob(prisma, 'process_github_event', { githubEventId: event.id });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'P2002') {
          return reply.status(200).send({ ok: true, duplicate: true });
        }
        throw error;
      }

      return reply.status(202).send({ ok: true });
    });
  });
}
