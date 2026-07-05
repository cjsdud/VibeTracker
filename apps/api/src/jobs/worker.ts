import { claimNextJob, completeJob, failJob, type PrismaClient } from '@vibetrack/tracker-core';
import { processGithubEvent } from '@vibetrack/github';

type JobHandler = (prisma: PrismaClient, payload: unknown) => Promise<void>;

/**
 * Job 타입 → 핸들러 매핑.
 * 새 비동기 작업이 생기면 여기에만 추가하면 된다.
 */
const handlers: Record<string, JobHandler> = {
  process_github_event: async (prisma, payload) => {
    const { githubEventId } = payload as { githubEventId: string };
    await processGithubEvent(prisma, githubEventId);
  },
};

export async function processOneJob(prisma: PrismaClient): Promise<boolean> {
  const job = await claimNextJob(prisma);
  if (!job) return false;
  const handler = handlers[job.type];
  try {
    if (!handler) {
      throw new Error(`알 수 없는 job 타입: ${job.type}`);
    }
    await handler(prisma, job.payload);
    await completeJob(prisma, job.id);
  } catch (error) {
    await failJob(prisma, job, error);
  }
  return true;
}

/**
 * Postgres polling worker.
 * V1에서는 API 프로세스에 내장해 돌리고(INLINE_WORKER=true),
 * 분리 시 apps/api/src/worker.ts 엔트리로 Render Background Worker에서 돌린다.
 */
export function startJobWorker(
  prisma: PrismaClient,
  opts: { intervalMs?: number } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 2000;
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      // 대기 중인 작업을 한 번에 소진한다
      while (!stopped && (await processOneJob(prisma))) {
        // continue
      }
    } catch (error) {
      console.error('[worker] tick 실패', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
