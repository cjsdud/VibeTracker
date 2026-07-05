# VibeTrack 로드맵

## Milestone 0: 기반 세팅

내용:

- pnpm workspace monorepo (apps/web, apps/api, packages/shared·tracker-core·github·mcp)
- TypeScript strict mode, ESLint + Prettier
- React 19 + Vite 7 웹 앱 골격
- Fastify 5 API 서버 골격
- Prisma + Postgres 스키마와 마이그레이션
- 환경변수 구조 (`.env.example`, Zod 검증)
- Vitest 테스트 구조
- Render 배포 문서 (`docs/setup.md`)

완료 기준:

- [x] `pnpm install && pnpm typecheck && pnpm lint && pnpm test`가 통과한다
- [x] `pnpm db:migrate` 후 API와 웹이 로컬에서 뜬다

## Milestone 1: 사용자 화면과 기능 트리

내용:

- 데모 로그인 (DEMO_MODE)
- 프로젝트 생성/조회/수정/삭제
- 기능 트리 CRUD (수동 생성/수정 포함)
- 3축 기능 상태 표시 (생명주기/구현/검증 → 사람이 읽는 문구)
- 프로젝트 대시보드 (핵심 기능 수, 검증 필요 수, 승인 대기 수, 추적 안 된 변경 수, 다음 작업 1개, 최근 작업 3개)
- Inbox / 활동 기록 화면
- 모바일 반응형 UI (390px)
- 데모 seed 데이터

완료 기준:

- [x] 데모 로그인 후 대시보드에서 프로젝트 상태와 다음 작업이 보인다
- [x] 기능 지도에서 트리와 기능 상세(파일/커밋/테스트/질문/타임라인)가 보인다
- [x] 퍼센트 진행률이 어디에도 없다

## Milestone 2: 실제 MCP 핵심 루프

내용:

- Remote MCP Streamable HTTP endpoint (`/mcp`)
- 프로젝트별 연결 토큰 (해시 저장, 폐기 가능)
- MCP 도구 6개: `get_project_context`, `get_feature_context`, `bootstrap_project_map`,
  `record_work_update`, `propose_structure_change`, `get_next_task`
- Claude Code 연결 안내 화면 (endpoint, 토큰, 설정 예시, CLAUDE.md 규칙, bootstrap 프롬프트)
- 초기 기능 지도 DRAFT → 사용자 승인 → ACTIVE 플로우

완료 기준:

- [x] 실제 MCP 클라이언트(Claude Code)가 토큰으로 접속해 6개 도구를 호출할 수 있다
- [x] bootstrap이 만든 지도는 승인 전까지 DRAFT다
- [x] 구조 변경 제안이 자동 반영되지 않고 Inbox에 쌓인다
- [x] e2e 테스트: 로그인 → 프로젝트 생성 → bootstrap → 승인 → record_work_update →
      구조 제안 → 승인 → 트리 변경 확인

## Milestone 3: GitHub 검증

내용:

- GitHub App 연결 (OAuth 로그인, App 설치, 저장소 목록/선택, 기본 브랜치 저장)
- push / pull_request / check_run / workflow_run webhook 수신
- webhook 서명 검증, delivery ID 중복 방지
- 빠른 저장 + 비동기 Job 처리
- 커밋/파일/테스트 증거를 기능에 연결
- 추적되지 않은 변경 → Inbox `UNTRACKED_CHANGE`
- MCP 작업 기록과 GitHub 커밋 대조 → 불일치 시 Inbox `EVIDENCE_MISMATCH`
- DEMO_MODE에서 webhook 파이프라인 시뮬레이션

완료 기준:

- [x] 서명이 틀린 webhook은 거부된다 (테스트 존재)
- [x] 같은 delivery ID는 두 번 처리되지 않는다 (테스트 존재)
- [x] push의 변경 파일이 기능 증거와 매칭되어 상태가 CHANGED/NEEDS_VERIFICATION으로 바뀐다
- [x] CI 실패가 기능 검증 상태 FAILED와 Inbox `TEST_FAILURE`로 반영된다
- [ ] 실제 GitHub App 자격증명으로 프로덕션 검증 (외부 키 필요)

## Milestone 4: 운영 안정화

내용:

- GitHub webhook 재시도 (Job attempts + 지수 backoff) — 구현됨
- Job queue 정리/모니터링 개선
- 감사 로그 (승인/토큰/삭제) — 구현됨
- 토큰 폐기 — 구현됨
- 프로젝트 삭제 / 데이터 삭제 요청
- 에러 화면 개선, 속도 개선
- Render Background Worker 분리 (`apps/api/src/worker.ts` + `INLINE_WORKER=false`)

완료 기준:

- [ ] webhook 처리 실패가 자동 재시도되고 최종 실패가 관측 가능하다
- [ ] Worker를 별도 서비스로 분리해도 코드 변경이 필요 없다
- [ ] 프로젝트 삭제 시 사용자 데이터가 범위 내에서 정리된다

## 아직 구현하지 않을 것 (V1 이후)

- 팀 협업, 멤버 초대, 역할별 권한
- MCP OAuth 인증 (현재는 Bearer 토큰, 인증 레이어는 교체 가능하게 추상화됨)
- VibeTrack 자체 LLM 분석 (기능 자동 매칭 등)
- 여러 저장소/모노레포 다중 연결
- Playwright 브라우저 e2e (Vitest e2e로 대체 중)
- 알림 (이메일/슬랙)
- 결제/구독
- Jira/Notion 연동
