import { type FastifyInstance } from 'fastify';
import { createPrismaClient, type PrismaClient } from '@vibetrack/tracker-core';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://vibetrack:vibetrack@localhost:5432/vibetrack_test';

export function createTestDb(): PrismaClient {
  return createPrismaClient(TEST_DATABASE_URL);
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function buildTestApp(
  prisma: PrismaClient,
  envOverrides: Partial<Record<string, string>> = {},
): Promise<FastifyInstance> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'test-session-secret-at-least-16-chars',
    APP_URL: 'http://localhost:5173',
    DEMO_MODE: 'true',
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    ...envOverrides,
  });
  return buildApp({ env, prisma });
}

/** demo-login으로 세션 쿠키를 얻는다. */
export async function demoLogin(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/demo-login' });
  if (response.statusCode !== 200) {
    throw new Error(`demo-login 실패: ${response.statusCode} ${response.body}`);
  }
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookieHeader) throw new Error('세션 쿠키가 없습니다');
  return cookieHeader.split(';')[0] ?? '';
}
