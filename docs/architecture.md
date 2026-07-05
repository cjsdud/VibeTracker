# VibeTrack 아키텍처

## 앱 구조 (pnpm workspace monorepo)

```
apps/
  web/            React 19 + Vite 7 웹 대시보드 (SPA)
  api/            Fastify 5 서버: REST API + MCP endpoint + GitHub webhook + Job worker
packages/
  shared/         Zod 스키마, 공용 타입, 상태 enum, 표시 상태 계산 (web/api/mcp 공용)
  tracker-core/   Prisma schema + 도메인 서비스 (기능 트리, 제안, 작업 기록, 다음 작업, Inbox)
  github/         GitHub App adapter, webhook 서명 검증, 이벤트 정규화/처리
  mcp/            MCP 서버 정의 (6개 도구), transport와 무관한 순수 구성
docs/             제품/아키텍처/셋업 문서
```

- **TypeScript strict** 모드. 서버 코드는 빌드 없이 `tsx`로 실행한다 (Render에서도 동일).
  웹은 Vite로 빌드하며, 프로덕션에서는 Fastify가 `apps/web/dist` 정적 파일을 서빙한다.
- Render Web Service 1개 + Render Postgres 1개로 배포한다. Redis 없음.

## 데이터 흐름

```
Claude Code ──MCP(Streamable HTTP, Bearer 토큰)──▶ /mcp ──▶ packages/mcp ──▶ tracker-core ──▶ Postgres
GitHub ──webhook(서명 검증)──▶ /api/github/webhook ──▶ GithubEvent 저장 + Job enqueue
Job worker ──poll──▶ Job 테이블 ──▶ packages/github processor ──▶ 증거 연결/상태 갱신/Inbox 생성
웹 브라우저 ──세션 쿠키──▶ /api/* ──▶ tracker-core ──▶ Postgres
```

핵심 규칙:

- **자동 반영**: 기존 기능에 커밋/파일/테스트 증거 연결, 검증 상태 갱신, 타임라인 추가.
- **승인 반영**: 기능 생성/종료/이름 변경/이동/병합/분리/대체는 `ChangeProposal(PENDING)`으로만
  생성되고, 사용자가 Inbox에서 승인해야 `FeatureTreeVersion` 새 버전과 함께 적용된다.

## MCP 구조

- SDK: `@modelcontextprotocol/sdk` **v1.29.0** (TypeScript SDK)
- Transport: **Streamable HTTP** (`StreamableHTTPServerTransport`) — SSE 전용 legacy transport가
  아니라 현행 표준 방식이다.
- Endpoint: `POST /mcp` (GET/DELETE는 stateless 모드이므로 405 반환)
- **Stateless 모드**로 운영한다: 요청마다 `McpServer` + transport 인스턴스를 생성하고
  `sessionIdGenerator: undefined`로 세션을 만들지 않는다. Render 단일 인스턴스/재시작 환경에서
  세션 상태를 유지할 필요가 없고, 수평 확장에도 안전하다.
- Fastify와의 연결: `reply.hijack()` 후 `transport.handleRequest(req.raw, reply.raw, req.body)`로
  Node 원시 req/res를 SDK에 넘긴다.
- 도구 입력은 모두 Zod로 검증한다 (`packages/shared`의 스키마 재사용).

### MCP 인증

- `Authorization: Bearer vtk_...` 프로젝트 범위 연결 토큰.
- 토큰은 **평문을 저장하지 않고 SHA-256 해시**로 저장한다 (`McpToken.tokenHash`).
  앞 8자 prefix만 표시용으로 저장한다.
- 토큰은 프로젝트 1개 범위로 제한되며 폐기(revoke) 가능하다.
- 인증 레이어는 `McpAuthenticator` 인터페이스로 추상화되어 있어, 이후 OAuth
  (MCP Authorization spec) 구현으로 교체할 수 있다.
- 도구 입력의 `projectId`는 토큰의 프로젝트와 일치해야 하며, 불일치 시 거부한다.

### MCP 도구 6개

| 도구                       | 역할                                                                                   | 쓰기 여부 |
| -------------------------- | -------------------------------------------------------------------------------------- | --------- |
| `get_project_context`      | 프로젝트 목표, 기능 트리 요약, 최근 작업, 검증 필요, 미해결 질문, 승인 대기, 다음 작업 | 읽기      |
| `get_feature_context`      | 기능 상태, 연결 파일/테스트/커밋, 최근 작업, 미해결 질문                               | 읽기      |
| `bootstrap_project_map`    | 초기 기능 지도 초안 등록. **무조건 DRAFT**, 웹 승인 후 ACTIVE                          | 쓰기      |
| `record_work_update`       | 작업 결과 기록. 타임라인/증거/검증 상태 자동 갱신. 구조 변경은 불가                    | 쓰기      |
| `propose_structure_change` | 구조 변경 제안. **무조건 PENDING ChangeProposal** 생성                                 | 쓰기      |
| `get_next_task`            | 규칙 기반 우선 작업 1개 + 이유 + 실행 지시문                                           | 읽기      |

## GitHub webhook 구조

- Endpoint: `POST /api/github/webhook`
- 처리 순서:
  1. **원문(raw body) 기준 `X-Hub-Signature-256` HMAC 검증** (`GITHUB_WEBHOOK_SECRET`)
  2. `X-GitHub-Delivery` ID로 **중복 수신 방지** (`GithubEvent.deliveryId` unique)
  3. `GithubEvent` 행으로 빠르게 저장하고 `Job`을 enqueue한 뒤 즉시 202 응답
  4. Job worker가 비동기로 처리
- 수신 이벤트: `push`, `pull_request`, `check_run`, `workflow_run`, `installation`

### 이벤트 처리 규칙 (packages/github processor)

1. push의 변경 파일이 기존 `FeatureEvidence(FILE)`와 매칭되면
   - 해당 기능에 COMMIT 증거 추가, `implementationStatus = CHANGED`,
     `verificationStatus = NEEDS_VERIFICATION`, `lastChangedAt` 갱신
2. 어떤 기능과도 매칭되지 않으면 → Inbox에 `UNTRACKED_CHANGE` 항목 생성
3. check_run / workflow_run 완료 이벤트는 commit SHA로 `WorkUpdate`/기능을 찾아
   `VerificationRun`을 만들고 검증 상태를 PASSED/FAILED로 갱신, 실패 시 `TEST_FAILURE` Inbox 생성
4. 파일 삭제/이름 변경이 들어와도 **FeatureNode를 자동 삭제하지 않는다.**
   같은 파일명이 다른 경로로 나타나면 증거 경로만 갱신하고, 아니면 `EVIDENCE_MISMATCH`
   Inbox 항목(구조 변경 후보)을 만든다
5. push commit SHA가 MCP `record_work_update`의 `gitHeadSha`와 일치하는데 변경 파일이
   서로 겹치지 않으면 `EVIDENCE_MISMATCH` Inbox 항목을 만든다

### GitHub App adapter

- `packages/github/src/app.ts`의 `GithubAppAdapter`가 Octokit App 클라이언트를 lazy 생성한다.
- 환경변수(`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` 등)가 없으면 adapter는 "not configured"
  상태를 반환하고, 앱은 DEMO_MODE로 계속 동작한다.
- DEMO_MODE에서는 `POST /api/demo/github/simulate`로 실제 webhook 처리 파이프라인
  (저장 → Job → processor)을 그대로 통과하는 합성 이벤트를 주입할 수 있다.

## 인증/권한 구조

- **웹 세션**: `@fastify/cookie` 서명 쿠키(`SESSION_SECRET`)에 userId를 담는다.
  데모 로그인(`DEMO_MODE=true`)과 GitHub OAuth(자격증명 존재 시) 두 가지 provider를
  `AuthProvider` adapter로 분리했다.
- **MCP**: 프로젝트 범위 Bearer 토큰 (위 참조).
- **권한 격리**: 모든 프로젝트 데이터 접근은 `tracker-core`의 `requireProjectAccess(prisma,
projectId, userId)`를 통과해야 한다. 다른 사용자의 프로젝트 접근은 404로 처리한다
  (존재 여부 노출 방지). MCP 쪽은 토큰의 projectId 범위로 격리된다.
- 민감 값(토큰 평문, 세션 시크릿)은 로그에 남기지 않는다.

## 데이터 모델 개요

Prisma schema: `packages/tracker-core/prisma/schema.prisma`
(생성 클라이언트는 `packages/tracker-core/generated/client`로 출력하고 tracker-core가 재수출한다)

| 모델                 | 역할                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `User`               | 사용자 (demo / GitHub OAuth)                                                              |
| `Project`            | 프로젝트. 목표(goal) 포함. 모든 데이터의 격리 경계                                        |
| `Repository`         | 연결된 GitHub 저장소 + 기본 브랜치                                                        |
| `GithubInstallation` | GitHub App 설치 정보                                                                      |
| `McpToken`           | 프로젝트 범위 MCP 연결 토큰 (해시 저장, 폐기 가능)                                        |
| `FeatureNode`        | 기능 노드. **고정 ID**, parentId 트리, 3축 상태                                           |
| `FeatureRelation`    | 병합/분리/대체 계보 (MERGED_INTO / SPLIT_FROM / REPLACED_BY)                              |
| `FeatureEvidence`    | 파일/라우트/API/테스트/커밋/PR/문서/작업기록 증거. **파일 경로는 여기에만 저장**          |
| `WorkUpdate`         | Claude Code 작업 기록 (요약, 변경 파일, SHA, 테스트, 다음 작업)                           |
| `WorkUpdateFeature`  | 작업 기록 ↔ 기능 다대다                                                                   |
| `ChangeProposal`     | 구조 변경 제안 (CREATE/RETIRE/RENAME/MOVE/MERGE/SPLIT/REPLACE, PENDING→APPROVED/REJECTED) |
| `FeatureTreeVersion` | 구조 변경마다 남는 트리 스냅샷 버전 (삭제하지 않음)                                       |
| `GithubEvent`        | 수신 webhook 원본 + deliveryId 중복 방지                                                  |
| `VerificationRun`    | 테스트/CI 실행 결과 (CI / MCP / MANUAL)                                                   |
| `Job`                | Postgres 기반 비동기 작업 큐 (재시도, backoff)                                            |
| `AuditLog`           | 승인/거절/토큰 발급 등 감사 기록 (삭제하지 않음)                                          |
| `InboxItem`          | 사용자가 확인해야 하는 항목 (제안, 추적 안 된 변경, 불일치, 테스트 실패, 지도 검토)       |
| `OpenQuestion`       | 기능/작업 기록에 달린 미해결 질문                                                         |

핵심 원칙:

- 기능 ID는 파일 경로가 아니라 고정 CUID. 파일은 `FeatureEvidence`일 뿐이다.
- 기능 삭제는 실제 삭제가 아니라 `lifecycle = RETIRED`.
- 구조 변경/승인 기록(`ChangeProposal`, `FeatureTreeVersion`, `AuditLog`)은 삭제하지 않는다.
- 모든 조회/변경은 projectId + userId 범위로 격리한다.

## 이벤트 처리(Job) 구조와 Worker 분리 계획

- `Job` 테이블: `status(PENDING/RUNNING/SUCCEEDED/FAILED)`, `attempts`, `maxAttempts`,
  `runAt`(지수 backoff 재시도), `lastError`.
- Claim은 `UPDATE ... WHERE status='PENDING'` 조건부 갱신으로 race-safe하게 처리한다.
- V1에서는 API 프로세스 안에서 polling worker(`startJobWorker`)가 함께 돈다.
- Worker 코드는 Fastify와 완전히 분리된 `apps/api/src/jobs/`에 있고, 별도 엔트리
  `apps/api/src/worker.ts`가 이미 존재한다. 트래픽이 늘면:
  1. Render Background Worker 서비스를 추가하고 start command를 `pnpm --filter api worker`로 지정
  2. API 쪽 환경변수 `INLINE_WORKER=false`로 내장 worker를 끈다
  3. 같은 Postgres를 바라보므로 코드 변경 없이 분리된다.

## 배포 구조 (Render)

- **Web Service 1개**: 웹 정적 파일 + REST API + `/mcp` + GitHub webhook. `tsx`로 실행.
- **Postgres 1개**: 전체 데이터.
- Redis/별도 Worker 없음 (위 분리 계획 참조).
- 상세 절차는 `docs/setup.md` 참조.
