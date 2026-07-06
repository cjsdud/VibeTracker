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

      // 저장소 → 프로젝트 매핑. 같은 저장소를 연결한 프로젝트가 여럿이면 전부에 전달한다.
      const fullName = (payload as WebhookRepositoryPayload).repository?.full_name;
      const repositories = fullName
        ? await prisma.repository.findMany({ where: { fullName } })
        : [];

      if (repositories.length === 0) {
        // 어떤 프로젝트와도 연결되지 않은 이벤트도 기록은 남긴다 (projectId null → SKIPPED 처리)
        const existing = await prisma.githubEvent.findFirst({
          where: { deliveryId, projectId: null },
        });
        if (existing) return reply.status(200).send({ ok: true, duplicate: true });
        await prisma.githubEvent.create({
          data: {
            deliveryId,
            eventType,
            action: typeof payload.action === 'string' ? payload.action : null,
            payload: payload as Prisma.InputJsonValue,
            projectId: null,
          },
        });
        return reply.status(202).send({ ok: true, matched: 0 });
      }

      // delivery ID는 프로젝트 단위로 중복 방지 (GitHub 재전송 대응).
      // 이벤트 저장과 Job enqueue는 한 트랜잭션으로 묶어 고아 이벤트를 막는다.
      let duplicates = 0;
      for (const repository of repositories) {
        try {
          await prisma.$transaction(async (tx) => {
            const event = await tx.githubEvent.create({
              data: {
                deliveryId,
                eventType,
                action: typeof payload.action === 'string' ? payload.action : null,
                payload: payload as Prisma.InputJsonValue,
                projectId: repository.projectId,
              },
            });
            await enqueueJob(tx, 'process_github_event', { githubEventId: event.id });
          });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === 'P2002') {
            duplicates += 1;
            continue;
          }
          throw error;
        }
      }
      if (duplicates === repositories.length) {
        return reply.status(200).send({ ok: true, duplicate: true });
      }
      return reply.status(202).send({ ok: true, matched: repositories.length });
    });
  });
}
