import { createPrismaClient } from '@vibetrack/tracker-core';
import { loadEnv } from './env.js';
import { startJobWorker } from './jobs/worker.js';

/**
 * 분리형 Job worker 엔트리 (Render Background Worker용).
 * Web Service에는 INLINE_WORKER=false를 설정해 내장 worker를 끈다.
 */
const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const worker = startJobWorker(prisma);
console.info('[worker] VibeTrack Job worker 실행 중');

const close = async () => {
  worker.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
