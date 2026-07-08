import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildBriefing,
  getDashboardCounts,
  getNextTask,
  getRecentWorkUpdates,
  requireProjectAccess,
  writeAudit,
} from '@vibetrack/tracker-core';
import { type ProjectDto } from '@vibetrack/shared';
import { type AppContext } from '../app.js';
import { requireUser } from '../auth/session.js';

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().max(2000).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  goal: z.string().max(2000).nullable().optional(),
});

export async function projectRoutes(
  app: FastifyInstance,
  opts: { ctx: AppContext },
): Promise<void> {
  const { prisma } = opts.ctx;

  const toDto = (project: {
    id: string;
    name: string;
    goal: string | null;
    createdAt: Date;
    repository: { id: string; fullName: string; defaultBranch: string } | null;
  }): ProjectDto => ({
    id: project.id,
    name: project.name,
    goal: project.goal,
    createdAt: project.createdAt.toISOString(),
    repository: project.repository
      ? {
          id: project.repository.id,
          fullName: project.repository.fullName,
          defaultBranch: project.repository.defaultBranch,
          connected: true,
        }
      : null,
  });

  app.get('/api/projects', async (request) => {
    const user = await requireUser(prisma, request);
    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      include: { repository: true },
      orderBy: { createdAt: 'asc' },
    });
    return { projects: projects.map(toDto) };
  });

  app.post('/api/projects', async (request, reply) => {
    const user = await requireUser(prisma, request);
    const body = createProjectSchema.parse(request.body);
    const project = await prisma.project.create({
      data: { userId: user.id, name: body.name, goal: body.goal ?? null },
      include: { repository: true },
    });
    await writeAudit(prisma, {
      projectId: project.id,
      userId: user.id,
      action: 'project.created',
    });
    return reply.status(201).send({ project: toDto(project) });
  });

  app.get('/api/projects/:projectId', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { repository: true },
    });
    return { project: { ...toDto(project), counts: await getDashboardCounts(prisma, projectId) } };
  });

  app.patch('/api/projects/:projectId', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const body = updateProjectSchema.parse(request.body);
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        name: body.name ?? undefined,
        goal: body.goal === undefined ? undefined : body.goal,
      },
      include: { repository: true },
    });
    return { project: toDto(project) };
  });

  app.delete('/api/projects/:projectId', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    // 프로젝트 삭제는 명시적 사용자 행동. 관계 데이터는 onDelete: Cascade로 정리된다.
    await prisma.project.delete({ where: { id: projectId } });
    await writeAudit(prisma, { userId: user.id, action: 'project.deleted', entityId: projectId });
    return { ok: true };
  });

  // 복귀 브리핑: 경과 시간·지난 작업·검증 필요·최근 코드 변경·문제 있음 (사실 나열만)
  app.get('/api/projects/:projectId/briefing', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    return { briefing: await buildBriefing(prisma, projectId) };
  });

  // 대시보드: 상태 요약 + 다음 작업 1개 + 최근 작업 3개
  app.get('/api/projects/:projectId/dashboard', async (request) => {
    const user = await requireUser(prisma, request);
    const { projectId } = request.params as { projectId: string };
    await requireProjectAccess(prisma, projectId, user.id);
    const [counts, nextTask, recentWork] = await Promise.all([
      getDashboardCounts(prisma, projectId),
      getNextTask(prisma, projectId),
      getRecentWorkUpdates(prisma, projectId, 3),
    ]);
    return { counts, nextTask, recentWork };
  });
}
