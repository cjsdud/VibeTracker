import { type Db, type Prisma } from '../db.js';

export async function writeAudit(
  db: Db,
  params: {
    projectId?: string | null;
    userId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    detail?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      projectId: params.projectId ?? null,
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      detail: params.detail,
    },
  });
}
