#!/usr/bin/env node
/**
 * VibeTracker 저장소 자신의 기능 지도를 VibeTrack에 등록하는 1회성 스크립트.
 * .mcp.json의 endpoint/토큰을 사용한다. 실행: node scripts/bootstrap-vibetracker.mjs
 * (이미 승인된 지도가 있으면 서버가 거부한다 — 구조 변경은 propose_structure_change로)
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PROJECT_ID = process.env.VIBETRACK_PROJECT_ID ?? 'cmr99ifp40001d54kfilygc9n';

const mcpConfig = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'))
  .mcpServers.vibetrack;
const baseCommitSha = execSync('git rev-parse HEAD').toString().trim();

const features = [
  {
    name: '사용자 접근',
    isCore: true,
    implementationStatus: 'IMPLEMENTED',
    children: [
      {
        name: '데모 로그인',
        description: 'GitHub 자격증명 없이 전체 흐름을 체험하는 데모 계정 로그인',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/api/src/routes/auth.ts', 'apps/web/src/pages/Login.tsx'],
          apiEndpoints: ['POST /api/auth/demo-login'],
          routes: ['/login'],
          tests: ['apps/api/tests/e2e.test.ts'],
        },
      },
      {
        name: 'GitHub 로그인',
        description: 'GitHub OAuth 로그인. adapter는 완성, 실제 자격증명 설정 필요',
        implementationStatus: 'PARTIAL',
        evidence: {
          files: ['apps/api/src/routes/auth.ts', 'packages/github/src/app.ts'],
          apiEndpoints: ['GET /api/auth/github', 'GET /api/auth/github/callback'],
        },
      },
      {
        name: '프로젝트 관리',
        description: '프로젝트 생성/전환/삭제와 사용자별 데이터 격리',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: [
            'apps/api/src/routes/projects.ts',
            'apps/web/src/pages/NewProject.tsx',
            'packages/tracker-core/src/access.ts',
          ],
          apiEndpoints: ['GET /api/projects', 'POST /api/projects'],
          tests: ['apps/api/tests/webhook.test.ts'],
        },
      },
    ],
  },
  {
    name: '기능 지도',
    isCore: true,
    implementationStatus: 'IMPLEMENTED',
    children: [
      {
        name: '초기 기능 지도 부트스트랩',
        description: 'Claude Code가 저장소를 분석해 DRAFT 기능 트리를 등록',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['packages/tracker-core/src/services/featureTree.ts'],
          tests: ['packages/tracker-core/tests/featureTree.test.ts'],
        },
      },
      {
        name: '기능 트리 화면과 상세',
        description: '트리 구조, 3축 상태 배지, 증거/타임라인 상세 패널',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/web/src/pages/FeatureMap.tsx', 'packages/tracker-core/src/dto.ts'],
          routes: ['/features'],
          apiEndpoints: ['GET /api/projects/:id/features'],
        },
      },
      {
        name: '기능 지도 승인',
        description: 'DRAFT 지도를 사용자가 검토·승인하면 ACTIVE로 전환 + 버전 기록',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          apiEndpoints: ['POST /api/projects/:id/feature-map/approve'],
          files: ['packages/tracker-core/src/services/featureTree.ts'],
          tests: ['packages/tracker-core/tests/featureTree.test.ts'],
        },
      },
      {
        name: '구조 변경 제안과 승인',
        description: '생성/종료/이름변경/이동/병합/분리/대체 — 항상 승인 대기 후 반영',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['packages/tracker-core/src/services/proposals.ts'],
          apiEndpoints: ['POST /api/projects/:id/proposals/:pid/approve'],
          tests: ['packages/tracker-core/tests/proposals.test.ts'],
        },
      },
    ],
  },
  {
    name: 'Claude Code 연동',
    isCore: true,
    implementationStatus: 'IMPLEMENTED',
    children: [
      {
        name: 'MCP 엔드포인트',
        description: 'Streamable HTTP stateless MCP 서버 + Bearer 토큰 인증',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/api/src/mcp/route.ts', 'packages/mcp/src/server.ts'],
          apiEndpoints: ['POST /mcp'],
          tests: ['packages/mcp/tests/tools.test.ts'],
        },
      },
      {
        name: '작업 기록',
        description: 'record_work_update: 타임라인/증거/검증 상태 자동 갱신, occurredAt 소급 기록',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['packages/tracker-core/src/services/workUpdates.ts'],
          tests: ['packages/tracker-core/tests/workUpdates.test.ts'],
        },
      },
      {
        name: '다음 작업 추천',
        description: '규칙 기반 우선순위로 지금 할 일 1개를 추천 (LLM 미사용)',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['packages/tracker-core/src/services/nextTask.ts'],
          tests: ['packages/tracker-core/tests/workUpdates.test.ts'],
        },
      },
      {
        name: '연결 토큰 관리',
        description: '프로젝트 범위 토큰 발급/폐기, SHA-256 해시 저장',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['packages/tracker-core/src/services/tokens.ts'],
          apiEndpoints: ['POST /api/projects/:id/mcp-tokens'],
          tests: ['packages/tracker-core/tests/tokens-isolation.test.ts'],
        },
      },
      {
        name: '연결 안내 화면',
        description: 'MCP 설정/CLAUDE.md 규칙/bootstrap·기록 가져오기 프롬프트 제공',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/web/src/pages/Settings.tsx', 'apps/api/src/routes/integrations.ts'],
          apiEndpoints: ['GET /api/projects/:id/claude-setup'],
        },
      },
      {
        name: '지난 세션 기록 가져오기',
        description: '과거 Claude Code 세션 로그를 occurredAt으로 소급 등록 (상태 변경 없음)',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: [
            'packages/tracker-core/src/services/workUpdates.ts',
            'docs/claude-code-setup.md',
          ],
          tests: ['packages/tracker-core/tests/workUpdates.test.ts'],
        },
      },
    ],
  },
  {
    name: 'GitHub 검증',
    implementationStatus: 'PARTIAL',
    children: [
      {
        name: 'Webhook 수신과 서명 검증',
        description: 'raw body HMAC 검증, delivery ID 프로젝트별 중복 방지, 트랜잭션 저장',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/api/src/github/webhook.ts', 'packages/github/src/signature.ts'],
          apiEndpoints: ['POST /api/github/webhook'],
          tests: ['apps/api/tests/webhook.test.ts', 'packages/github/tests/signature.test.ts'],
        },
      },
      {
        name: '이벤트 처리와 증거 연결',
        description: 'push/PR/CI 이벤트를 기능 증거로 연결, untracked/불일치 Inbox 생성, 재시도 멱등',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['packages/github/src/processor.ts'],
          tests: ['packages/github/tests/processor.test.ts'],
        },
      },
      {
        name: 'GitHub App 연동',
        description: '저장소 목록/연결, OAuth. adapter 완성 — 실제 App 생성과 키 설정 필요',
        implementationStatus: 'PARTIAL',
        evidence: {
          files: ['packages/github/src/app.ts', 'docs/github-app-setup.md'],
          apiEndpoints: ['GET /api/github/repos', 'POST /api/projects/:id/github/connect'],
        },
      },
      {
        name: '데모 이벤트 시뮬레이션',
        description: '실제 webhook 파이프라인을 통과하는 합성 이벤트 (DEMO_MODE)',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/api/src/routes/demo.ts'],
          apiEndpoints: ['POST /api/projects/:id/demo/github/simulate'],
        },
      },
    ],
  },
  {
    name: '대시보드와 알림',
    isCore: true,
    implementationStatus: 'IMPLEMENTED',
    children: [
      {
        name: '프로젝트 대시보드',
        description: '다음 작업 1개 + 핵심 지표 4개 + 최근 작업 3개',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/web/src/pages/Dashboard.tsx'],
          routes: ['/'],
          apiEndpoints: ['GET /api/projects/:id/dashboard'],
        },
      },
      {
        name: 'Inbox',
        description: '구조 제안 승인/거절, 추적 안 된 변경 연결, 불일치/테스트 실패 확인',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/web/src/pages/Inbox.tsx', 'packages/tracker-core/src/services/inbox.ts'],
          routes: ['/inbox'],
          apiEndpoints: ['GET /api/projects/:id/inbox'],
        },
      },
      {
        name: '활동 기록',
        description: '작업/커밋/테스트/승인 이벤트를 시간순으로 통합 표시',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: [
            'apps/web/src/pages/Activity.tsx',
            'packages/tracker-core/src/services/activity.ts',
          ],
          routes: ['/activity'],
        },
      },
    ],
  },
  {
    name: '운영',
    implementationStatus: 'IMPLEMENTED',
    children: [
      {
        name: 'Render 배포',
        description: 'Blueprint(render.yaml) 단일 웹 서비스 + Neon Postgres',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['render.yaml', 'docs/setup.md'],
          documents: ['docs/setup.md'],
        },
      },
      {
        name: '비동기 작업 큐',
        description: 'Postgres 기반 job 큐, race-safe claim, 지수 backoff, Worker 분리 가능',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['packages/tracker-core/src/services/jobs.ts', 'apps/api/src/jobs/worker.ts'],
        },
      },
      {
        name: '데모 모드와 시드 데이터',
        description: '데모 사용자/프로젝트/기록 자동 시드 (idempotent)',
        implementationStatus: 'IMPLEMENTED',
        evidence: {
          files: ['apps/api/src/demo/seed.ts'],
        },
      },
    ],
  },
];

const response = await fetch(mcpConfig.url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...mcpConfig.headers,
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'bootstrap_project_map',
      arguments: {
        projectId: PROJECT_ID,
        baseCommitSha,
        projectGoal:
          'Claude Code와 GitHub의 작업 흔적을 모아, AI가 만든 프로젝트에서 무엇이 구현됐고 무엇이 검증되지 않았으며 다음에 무엇을 해야 하는지 보여주는 프로젝트 기억 서비스',
        features,
      },
    },
  }),
});

const data = await response.json();
const text = data?.result?.content?.[0]?.text;
if (data?.result?.isError || data?.error) {
  console.error('등록 실패:', text ?? JSON.stringify(data).slice(0, 500));
  process.exit(1);
}
const parsed = JSON.parse(text);
console.info(`기능 지도 초안 등록 완료: ${parsed.draftCount}개 기능 (HEAD ${baseCommitSha.slice(0, 7)})`);
console.info('VibeTrack 웹에서 기능 지도를 검토하고 승인하세요.');
