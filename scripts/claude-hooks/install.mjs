#!/usr/bin/env node
/* global process, URL, fetch, console */
/**
 * VibeTrack SessionStart 훅 설치 — 프로젝트 루트에서 한 번 실행하면 끝.
 *
 * 1) .mcp.json의 vibetrack 항목에서 서버 주소를 찾아 훅 스크립트를 내려받고
 * 2) .claude/settings.json에 SessionStart 훅을 등록한다 (기존 설정 보존, 중복 등록 방지)
 *
 * 사용: VibeTrack 설정 화면의 설치 명령을 복사해 프로젝트 루트에서 실행
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const fail = (message) => {
  console.error(`[vibetrack] ${message}`);
  process.exit(1);
};

// 1) .mcp.json에서 서버 주소 찾기
const mcpPath = join(root, '.mcp.json');
if (!existsSync(mcpPath)) {
  fail('.mcp.json이 없습니다. 먼저 VibeTrack 설정 화면의 "Claude Code 연결"부터 완료하세요.');
}
let origin;
try {
  const server = JSON.parse(readFileSync(mcpPath, 'utf8'))?.mcpServers?.vibetrack;
  if (!server?.url) fail('.mcp.json에 vibetrack 서버 설정이 없습니다.');
  origin = new URL(server.url).origin;
} catch (error) {
  fail(`.mcp.json을 읽을 수 없습니다: ${error.message}`);
}

// 2) 훅 스크립트 내려받기
const hookDir = join(root, '.claude', 'hooks');
mkdirSync(hookDir, { recursive: true });
const res = await fetch(`${origin}/hook/vibetrack-briefing.mjs`).catch(() => null);
if (!res || !res.ok) {
  fail(`훅 스크립트를 내려받지 못했습니다: ${origin}/hook/vibetrack-briefing.mjs`);
}
const hookPath = join(hookDir, 'vibetrack-briefing.mjs');
writeFileSync(hookPath, await res.text());

// 3) .claude/settings.json에 SessionStart 훅 병합 등록
const settingsPath = join(root, '.claude', 'settings.json');
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    fail('.claude/settings.json이 올바른 JSON이 아닙니다. 파일을 확인한 뒤 다시 실행하세요.');
  }
}
const command = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/vibetrack-briefing.mjs"';
settings.hooks ??= {};
settings.hooks.SessionStart ??= [];
const alreadyInstalled = JSON.stringify(settings.hooks.SessionStart).includes(
  'vibetrack-briefing.mjs',
);
if (!alreadyInstalled) {
  settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
}
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

console.info('[vibetrack] SessionStart 훅 설치 완료');
console.info(`- 훅 스크립트: ${hookPath}`);
console.info(
  `- .claude/settings.json에 훅 등록${alreadyInstalled ? ' (이미 등록되어 있어 건너뜀)' : ''}`,
);
console.info('다음 Claude Code 세션부터 복귀 브리핑이 자동으로 주입됩니다.');
console.info('(훅 실패 시에는 아무것도 출력하지 않고 조용히 넘어갑니다 — 세션을 막지 않습니다)');
