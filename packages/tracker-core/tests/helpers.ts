import { createPrismaClient, type PrismaClient } from '../src/index.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://vibetrack:vibetrack@localhost:5432/vibetrack_test';

export function createTestDb(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL);
}

/** 모든 테이블을 비운다 (_prisma_migrations 제외). */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createUserAndProject(
  prisma: PrismaClient,
  suffix = '1',
): Promise<{ userId: string; projectId: string }> {
  const user = await prisma.user.create({
    data: { name: `테스터${suffix}`, email: `tester${suffix}@test.local` },
  });
  const project = await prisma.project.create({
    data: { userId: user.id, name: `테스트 프로젝트 ${suffix}`, goal: '테스트' },
  });
  return { userId: user.id, projectId: project.id };
}
