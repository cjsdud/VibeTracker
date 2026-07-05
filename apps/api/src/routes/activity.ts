import { type FastifyInstance } from 'fastify';
import {
  listActivity,
  listGithubEvents,
  requireProjectAccess,
  toVerificationRunDto,
  toWorkUpdateDto,
} from '@vibetrack/tracker-core';
import { type AppContext } from '../app.js';
import { requireUser } from '../auth/session.js';

export async function activityRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { prisma } = opts.ctx;

  app.get('/api/projects/:projectId/activity', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    return { items: await listActivity(prisma, projectId, 50) };
  });

  app.get('/api/projects/:projectId/work-updates', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const updates = await prisma.workUpdate.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { features: { include: { featureNode: { select: { id: true, name: true } } } } },
    });
    return { workUpdates: updates.map(toWorkUpdateDto) };
  });

  app.get('/api/projects/:projectId/github-events', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    return { events: await listGithubEvents(prisma, projectId, 50) };
  });

  app.get('/api/projects/:projectId/verification-runs', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const runs = await prisma.verificationRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { runs: runs.map(toVerificationRunDto) };
  });
}
