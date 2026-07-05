import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://vibetrack:vibetrack@localhost:5432/vibetrack_test';
  const trackerCoreDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../packages/tracker-core',
  );
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: trackerCoreDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
