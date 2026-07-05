import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  approveInitialFeatureMap,
  approveProposal,
  createFeatureManual,
  editProposal,
  getFeatureContext,
  getFeatureTree,
  rejectProposal,
  requireProjectAccess,
  toProposalDto,
  updateFeatureManual,
} from '@vibetrack/tracker-core';
import { type AppContext } from '../app.js';
import { requireUser } from '../auth/session.js';

const createFeatureSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  parentId: z.string().nullable().optional(),
  isCore: z.boolean().optional(),
});

const updateFeatureSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  isCore: z.boolean().optional(),
  implementationStatus: z.enum(['NOT_STARTED', 'PARTIAL', 'IMPLEMENTED', 'CHANGED']).optional(),
  verificationStatus: z
    .enum(['UNKNOWN', 'NEEDS_VERIFICATION', 'PASSED', 'FAILED', 'MANUAL_VERIFIED'])
    .optional(),
  retire: z.boolean().optional(),
});

const editProposalSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(4000).optional(),
  payloadPatch: z.record(z.unknown()).optional(),
});

export async function featureRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { prisma } = opts.ctx;

  app.get('/api/projects/:projectId/features', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    return { tree: await getFeatureTree(prisma, projectId) };
  });

  app.get('/api/projects/:projectId/features/:featureId', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, featureId } = request.params as { projectId: string; featureId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    return { feature: await getFeatureContext(prisma, projectId, featureId) };
  });

  app.post('/api/projects/:projectId/features', async (request, reply) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = createFeatureSchema.parse(request.body);
    const node = await createFeatureManual(prisma, {
      projectId,
      userId: user.id,
      name: body.name,
      description: body.description,
      parentId: body.parentId ?? null,
      isCore: body.isCore,
    });
    return reply.status(201).send({ featureId: node.id });
  });

  app.patch('/api/projects/:projectId/features/:featureId', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, featureId } = request.params as { projectId: string; featureId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = updateFeatureSchema.parse(request.body);
    await updateFeatureManual(prisma, { projectId, userId: user.id, featureId, ...body });
    return { ok: true };
  });

  // 초기 기능 지도 승인: DRAFT 전체 → ACTIVE
  app.post('/api/projects/:projectId/feature-map/approve', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const result = await approveInitialFeatureMap(prisma, { projectId, userId: user.id });
    return { tree: result.tree, version: result.version };
  });

  app.get('/api/projects/:projectId/proposals', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    const { status } = request.query as { status?: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const proposals = await prisma.changeProposal.findMany({
      where: {
        projectId,
        ...(status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)
          ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const result = [];
    for (const proposal of proposals) {
      const targets = proposal.targetFeatureIds.length
        ? await prisma.featureNode.findMany({
            where: { id: { in: proposal.targetFeatureIds } },
            select: { name: true },
          })
        : [];
      result.push(
        toProposalDto(
          proposal,
          targets.map((t) => t.name),
        ),
      );
    }
    return { proposals: result };
  });

  app.post('/api/projects/:projectId/proposals/:proposalId/approve', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, proposalId } = request.params as { projectId: string; proposalId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const result = await approveProposal(prisma, { projectId, userId: user.id, proposalId });
    return { proposal: toProposalDto(result.proposal), version: result.version };
  });

  app.post('/api/projects/:projectId/proposals/:proposalId/reject', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, proposalId } = request.params as { projectId: string; proposalId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = z.object({ note: z.string().max(1000).optional() }).parse(request.body ?? {});
    const proposal = await rejectProposal(prisma, {
      projectId,
      userId: user.id,
      proposalId,
      note: body.note,
    });
    return { proposal: toProposalDto(proposal) };
  });

  app.patch('/api/projects/:projectId/proposals/:proposalId', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId, proposalId } = request.params as { projectId: string; proposalId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = editProposalSchema.parse(request.body);
    const proposal = await editProposal(prisma, {
      projectId,
      userId: user.id,
      proposalId,
      title: body.title,
      reason: body.reason,
      payloadPatch: body.payloadPatch as never,
    });
    return { proposal: toProposalDto(proposal) };
  });
}
