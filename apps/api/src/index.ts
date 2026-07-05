import { createPrismaClient } from '@vibetrack/tracker-core';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { startJobWorker } from './jobs/worker.js';
import { ensureDemoData } from './demo/seed.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const app = await buildApp({ env, prisma });

  if (env.DEMO_MODE) {
    await ensureDemoData(prisma);
    app.log.info('DEMO_MODE: 데모 데이터 준비 완료');
  }

  let worker: { stop: () => void } | null = null;
  if (env.INLINE_WORKER) {
    worker = startJobWorker(prisma);
    app.log.info('내장 Job worker 시작');
  }

  const close = async () => {
    worker?.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error('서버 시작 실패:', error);
  process.exit(1);
});
