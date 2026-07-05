# VibeTrack

Claude Code 같은 AI 코딩 에이전트와 GitHub에 흩어진 작업 흔적을 모아,
**현재 프로젝트에서 무엇이 구현됐고, 무엇이 검증되지 않았으며, 다음에 무엇을 해야 하는지**
보여주는 프로젝트 기억 서비스.

- 할 일 관리가 아니라 **AI가 만든 프로젝트의 실제 상태 추적**
- Claude Code가 MCP로 초기 기능 지도를 만들고 작업 결과를 자동 기록
- GitHub가 커밋/파일/테스트 결과로 실제 변경을 검증
- 기능 생성/종료/병합/분리/이동/이름 변경은 **사용자 승인 후에만** 반영
- 퍼센트 진행률 없음 — 사람이 읽는 상태만 ("구현됨", "검증 필요", "문제 있음"…)
- VibeTrack 자체 LLM 호출 없음 — 판단은 사용자의 Claude Code가 수행

문서: [제품 정의](docs/product.md) · [아키텍처](docs/architecture.md) ·
[로드맵](docs/roadmap.md) · [셋업](docs/setup.md) ·
[GitHub App 설정](docs/github-app-setup.md) · [Claude Code 연결](docs/claude-code-setup.md)

## 구조

```
apps/web            React 19 + Vite 웹 대시보드
apps/api            Fastify: REST API + /mcp (Streamable HTTP) + GitHub webhook + Job worker
packages/shared     Zod 스키마, 공용 타입/enum, 표시 상태 계산
packages/tracker-core  Prisma schema + 도메인 서비스 (트리/제안/기록/다음 작업)
packages/github     GitHub App adapter, webhook 서명 검증, 이벤트 처리
packages/mcp        MCP 서버 (도구 6개)
```

## 빠른 시작

요구 사항: Node 22+, pnpm 10+, PostgreSQL 16+

```bash
pnpm install
cp .env.example .env            # DATABASE_URL 등 확인
createdb vibetrack               # 또는 원하는 방식으로 DB 준비
pnpm db:migrate                  # prisma migrate deploy
pnpm dev                         # api(:3001) + web(:5173)
```

`DEMO_MODE=true`(기본 예시값)면 http://localhost:5173 에서 **"데모로 시작하기"** 로
GitHub 자격증명 없이 전체 흐름(대시보드, 기능 지도, Inbox, MCP, webhook 시뮬레이션)을 볼 수 있다.

### Claude Code 연결

웹의 **연결/설정 → Claude Code MCP 연결**에서 프로젝트별 값이 채워진 안내를 복사한다.

```bash
claude mcp add --transport http vibetrack http://localhost:3001/mcp \
  --header "Authorization: Bearer vtk_발급받은_토큰"
```

MCP 도구 6개: `get_project_context`, `get_feature_context`, `bootstrap_project_map`,
`record_work_update`, `propose_structure_change`, `get_next_task`

## 테스트 / 품질

```bash
pnpm test        # vitest 전체 (63 tests) — vibetrack_test DB 필요 (TEST_DATABASE_URL)
pnpm typecheck   # tsc strict 전체
pnpm lint        # eslint
pnpm build       # 웹 프로덕션 빌드
```

테스트는 `TEST_DATABASE_URL`(기본 `postgresql://vibetrack:vibetrack@localhost:5432/vibetrack_test`)
을 사용하며 시작 시 스키마를 push하고 테이블을 비운다. 개발 DB와 분리할 것.

포함된 테스트: 기능 트리 bootstrap/승인, 구조 제안 승인(7종), record_work_update 상태 전이,
get_next_task 우선순위, 토큰 해시/폐기/인증, 프로젝트 격리, webhook 서명 검증/중복 방지,
GitHub 이벤트 처리 규칙, MCP 도구 검증, **E2E happy path**
(데모 로그인 → 프로젝트 생성 → 실제 MCP 클라이언트로 bootstrap → 승인 → 작업 기록 →
구조 제안 → Inbox 승인 → 트리 변경 확인).

## 환경변수

| 변수                                        | 필수             | 설명                                          |
| ------------------------------------------- | ---------------- | --------------------------------------------- |
| `DATABASE_URL`                              | O                | Postgres 연결 문자열                          |
| `SESSION_SECRET`                            | O                | 세션 쿠키 서명 키 (16자 이상)                 |
| `APP_URL`                                   | O                | 외부 접근 URL                                 |
| `PORT`                                      | -                | API 포트 (기본 3001)                          |
| `DEMO_MODE`                                 | -                | `true`면 데모 로그인/데이터/시뮬레이션        |
| `INLINE_WORKER`                             | -                | `false`면 내장 Job worker 끔 (Worker 분리 시) |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`  | GitHub 연동 시   | GitHub App 자격증명                           |
| `GITHUB_WEBHOOK_SECRET`                     | GitHub 연동 시   | webhook 서명 secret                           |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub 로그인 시 | OAuth 자격증명                                |
| `TEST_DATABASE_URL`                         | 테스트 시        | 테스트 전용 DB                                |

## Render 배포

1. Render Postgres 생성 → `DATABASE_URL` 확보
2. Render Web Service 생성
   - Build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`
   - Pre-deploy: `pnpm db:migrate`
   - Start: `pnpm start` (웹 정적 파일 포함 단일 서비스)
3. GitHub App webhook URL: `https://<도메인>/api/github/webhook`
4. 트래픽 증가 시 Background Worker 추가: Start `pnpm worker`, Web에 `INLINE_WORKER=false`

자세한 내용은 [docs/setup.md](docs/setup.md).
