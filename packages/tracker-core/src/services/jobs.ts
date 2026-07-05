import { type Db, type Job, type Prisma, type PrismaClient } from '../db.js';

/**
 * Postgres 기반 단순 Job 큐.
 * 조건부 UPDATE로 claim하므로 API 프로세스 내장 worker와
 * 분리된 Background Worker가 동시에 돌아도 안전하다.
 */
export async function enqueueJob(
  db: Db,
  type: string,
  payload: Prisma.InputJsonValue,
  opts?: { maxAttempts?: number; runAt?: Date },
): Promise<Job> {
  return db.job.create({
    data: {
      type,
      payload,
      maxAttempts: opts?.maxAttempts ?? 5,
      runAt: opts?.runAt ?? new Date(),
    },
  });
}

/** PENDING 작업 하나를 race-safe하게 가져간다. 없으면 null. */
export async function claimNextJob(prisma: PrismaClient): Promise<Job | null> {
  const candidates = await prisma.job.findMany({
    where: { status: 'PENDING', runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' },
    take: 5,
  });
  for (const candidate of candidates) {
    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 1) {
      return prisma.job.findUniqueOrThrow({ where: { id: candidate.id } });
    }
  }
  return null;
}

export async function completeJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'SUCCEEDED', finishedAt: new Date(), lastError: null },
  });
}

/** 실패 처리: 남은 시도가 있으면 지수 backoff로 재시도 예약. */
export async function failJob(prisma: PrismaClient, job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;
  if (exhausted) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: new Date(), lastError: message.slice(0, 2000) },
    });
    return;
  }
  const backoffMs = Math.min(60_000 * 2 ** (job.attempts - 1), 30 * 60_000);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: 'PENDING',
      runAt: new Date(Date.now() + backoffMs),
      lastError: message.slice(0, 2000),
    },
  });
}
