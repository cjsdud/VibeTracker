import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  linkUntrackedChangeToFeature,
  listInboxItems,
  requireProjectAccess,
  resolveInboxItem,
} from '@vibetrack/tracker-core';
import { type AppContext } from '../app.js';
import { requireUser } from '../auth/session.js';

export async function inboxRoutes(app: FastifyInstance, opts: { ctx: AppContext }): Promise<void> {
  const { prisma } = opts.ctx;

  app.get('/api/projects/:projectId/inbox', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    const { status } = request.query as { status?: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const filter =
      status && ['OPEN', 'RESOLVED', 'DISMISSED', 'ALL'].includes(status)
        ? (status as 'OPEN' | 'RESOLVED' | 'DISMISSED' | 'ALL')
        : 'OPEN';
    return { items: await listInboxItems(prisma, projectId, filter) };
  });

  app.post('/api/projects/:projectId/inbox/:itemId/resolve', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = z
      .object({
        action: z.enum(['RESOLVED', 'DISMISSED']).default('RESOLVED'),
        note: z.string().max(1000).optional(),
      })
      .parse(request.body ?? {});
    await resolveInboxItem(prisma, {
      projectId,
      userId: user.id,
      inboxItemId: itemId,
      action: body.action,
      note: body.note,
    });
    return { ok: true };
  });

  app.post('/api/projects/:projectId/inbox/:itemId/link-feature', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = z.object({ featureId: z.string().min(1) }).parse(request.body);
    await linkUntrackedChangeToFeature(prisma, {
      projectId,
      userId: user.id,
      inboxItemId: itemId,
      featureId: body.featureId,
    });
    return { ok: true };
  });
}
