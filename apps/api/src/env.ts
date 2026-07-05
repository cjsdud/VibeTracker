import { z } from 'zod';

const boolFromString = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL이 필요합니다'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET은 16자 이상이어야 합니다'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  DEMO_MODE: boolFromString,
  INLINE_WORKER: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: Partial<Record<string, string>> = {}): Env {
  const merged = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`환경변수 설정 오류: ${issues}`);
  }
  return parsed.data;
}
