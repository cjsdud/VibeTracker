#!/usr/bin/env node
/* global process, URL, fetch, AbortSignal */
/**
 * VibeTrack SessionStart 훅: 세션 시작 시 복귀 브리핑을 컨텍스트에 주입한다.
 *
 * - .mcp.json의 vibetrack 항목에서 서버 주소와 토큰을 읽는다 (별도 시크릿 파일 불필요).
 *   환경 변수 VIBETRACK_URL / VIBETRACK_TOKEN이 있으면 그것을 우선 사용한다.
 * - HTTP는 fetch를 먼저 쓰고, 실패하면 curl로 재시도한다.
 *   (웹 클로드 코드 등 프록시 경유 환경에서 node fetch는 프록시를 무시해 실패하지만
 *   curl은 HTTPS_PROXY와 시스템 CA를 자동 인식한다)
 * - 어떤 실패(네트워크 오류, 토큰 만료, 설정 없음)에도 아무것도 출력하지 않고
 *   조용히 종료한다 — 훅이 세션을 막으면 안 된다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function httpGet(url, authHeader) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return await res.text();
  } catch {
    // fetch 실패 → curl 폴백
  }
  try {
    return execFileSync(
      'curl',
      ['-fsS', '--max-time', '8', '-H', `Authorization: ${authHeader}`, url],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return null;
  }
}

try {
  let baseUrl = process.env.VIBETRACK_URL ?? null;
  let authHeader = process.env.VIBETRACK_TOKEN ? `Bearer ${process.env.VIBETRACK_TOKEN}` : null;

  if (!baseUrl || !authHeader) {
    const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const config = JSON.parse(readFileSync(join(projectDir, '.mcp.json'), 'utf8'));
    const server = config?.mcpServers?.vibetrack;
    const auth = server?.headers?.Authorization ?? server?.headers?.authorization;
    if (server?.url && auth) {
      baseUrl = baseUrl ?? new URL(server.url).origin;
      authHeader = authHeader ?? auth;
    }
  }
  if (!baseUrl || !authHeader) process.exit(0);

  const raw = await httpGet(`${baseUrl.replace(/\/$/, '')}/api/briefing`, authHeader);
  if (!raw) process.exit(0);
  const data = JSON.parse(raw);
  const text = data?.briefing?.briefingText;
  if (typeof text === 'string' && text.length > 0) {
    process.stdout.write(text + '\n');
  }
} catch {
  // 조용히 스킵 — 브리핑이 없어도 세션은 정상 진행되어야 한다
}
process.exit(0);
