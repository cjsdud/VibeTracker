import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueJob, requireProjectAccess, type Prisma } from '@vibetrack/tracker-core';
import { type AppContext } from '../app.js';
import { requireUser } from '../auth/session.js';
import { processOneJob } from '../jobs/worker.js';
import { DEMO_SHAS } from '../demo/seed.js';

const simulateSchema = z.object({
  scenario: z.enum([
    'push_tracked',
    'push_untracked',
    'check_success',
    'check_failure',
    'pr_opened',
  ]),
});

/**
 * DEMO_MODE 전용: GitHub webhook 파이프라인을 합성 이벤트로 시뮬레이션한다.
 * 실제 webhook과 같은 경로(GithubEvent 저장 → Job → processor)를 그대로 통과한다.
 */
export async function demoRoutes(app: FastifyInstance, opts: { ctx: AppContext }): Promise<void> {
  const { prisma } = opts.ctx;

  app.post('/api/projects/:projectId/demo/github/simulate', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const { scenario } = simulateSchema.parse(request.body);

    const repository = await prisma.repository.findUnique({ where: { projectId } });
    const fullName = repository?.fullName ?? 'demo/review-insight';
    const sha = randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40);

    let eventType: string;
    let payload: Record<string, unknown>;
    switch (scenario) {
      case 'push_tracked':
        eventType = 'push';
        payload = {
          ref: 'refs/heads/main',
          after: sha,
          repository: { full_name: fullName },
          commits: [
            {
              id: sha,
              message: 'feat: 권한 검사 캐시 추가',
              added: [],
              modified: ['src/server/auth/roles.ts'],
              removed: [],
            },
          ],
        };
        break;
      case 'push_untracked':
        eventType = 'push';
        payload = {
          ref: 'refs/heads/main',
          after: sha,
          repository: { full_name: fullName },
          commits: [
            {
              id: sha,
              message: 'chore: 실험용 노트북 스크립트 추가',
              added: [`experiments/notebook-${sha.slice(0, 6)}.ts`],
              modified: [],
              removed: [],
            },
          ],
        };
        break;
      case 'check_success':
      case 'check_failure':
        eventType = 'check_run';
        payload = {
          action: 'completed',
          check_run: {
            name: 'CI / test',
            head_sha: DEMO_SHAS.admin,
            conclusion: scenario === 'check_success' ? 'success' : 'failure',
            html_url: `https://github.com/${fullName}/actions`,
          },
          repository: { full_name: fullName },
        };
        break;
      case 'pr_opened':
        eventType = 'pull_request';
        payload = {
          action: 'opened',
          pull_request: {
            number: 42,
            title: '권한 관리 리팩터링',
            merged: false,
            head: { sha: DEMO_SHAS.admin },
            html_url: `https://github.com/${fullName}/pull/42`,
          },
          repository: { full_name: fullName },
        };
        break;
    }

    const event = await prisma.githubEvent.create({
      data: {
        projectId,
        deliveryId: `demo-sim-${randomUUID()}`,
        eventType,
        action: (payload as { action?: string }).action ?? null,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    await enqueueJob(prisma, 'process_github_event', { githubEventId: event.id });

    // 데모에서는 결과를 바로 보여주기 위해 대기 중인 job을 즉시 소진한다
    while (await processOneJob(prisma)) {
      // drain
    }

    return { ok: true, eventId: event.id, scenario };
  });
}
