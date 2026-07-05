import { createPrismaClient } from '@vibetrack/tracker-core';
import { loadEnv } from './env.js';
import { ensureDemoData } from './demo/seed.js';

/** `pnpm db:seed`: DEMO_MODE 데모 데이터를 생성한다 (idempotent). */
async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const { user, project } = await ensureDemoData(prisma);
  console.info(`데모 데이터 준비 완료: user=${user.email} project="${project.name}" (${project.id})`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('seed 실패:', error);
  process.exit(1);
});
