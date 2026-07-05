# VibeTrack 셋업 가이드

## 요구 사항

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+

## 로컬 실행

```bash
# 1. 의존성 설치
pnpm install

# 2. 환경변수 준비
cp .env.example .env
# DATABASE_URL, SESSION_SECRET 등을 채운다. 데모만 돌릴 경우 기본값으로 충분하다.

# 3. 데이터베이스 준비 (예: 로컬 Postgres)
createdb vibetrack
pnpm db:migrate          # prisma migrate deploy
pnpm db:seed             # DEMO_MODE 데모 데이터 (선택, DEMO_MODE=true일 때 의미 있음)

# 4. 개발 서버
pnpm dev                 # api(:3001) + web(:5173) 동시 실행
```

- 웹: http://localhost:5173 (dev 서버가 `/api`, `/mcp`를 :3001로 프록시)
- API: http://localhost:3001
- MCP endpoint: http://localhost:3001/mcp

DEMO_MODE=true이면 로그인 화면에 "데모로 시작하기" 버튼이 나온다. 데모 사용자/프로젝트/
기능 트리/작업 기록/GitHub 이벤트가 seed되어 있어 GitHub 자격증명 없이 전체 흐름을 볼 수 있다.

## 테스트 / 품질

```bash
pnpm test         # vitest (DB 필요: DATABASE_URL 또는 TEST_DATABASE_URL의 *_test DB 사용)
pnpm typecheck    # tsc --noEmit 전체 워크스페이스
pnpm lint         # eslint
pnpm build        # 웹 프로덕션 빌드 (apps/web/dist)
```

테스트는 `TEST_DATABASE_URL`(기본값: `postgresql://vibetrack:vibetrack@localhost:5432/vibetrack_test`)
데이터베이스를 사용하며 시작 시 스키마를 push하고 테이블을 비운다. **개발 DB와 반드시 분리할 것.**

## 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | O | Postgres 연결 문자열 |
| `SESSION_SECRET` | O | 세션 쿠키 서명 키 (32자 이상 무작위 문자열) |
| `APP_URL` | O | 외부에서 접근하는 앱 URL (예: `https://vibetrack.onrender.com`) |
| `PORT` | - | API 포트 (기본 3001, Render는 자동 주입) |
| `DEMO_MODE` | - | `true`면 데모 로그인/데모 데이터/이벤트 시뮬레이션 활성화 |
| `INLINE_WORKER` | - | `false`면 API 프로세스 내 Job worker를 끈다 (기본 true) |
| `GITHUB_APP_ID` | GitHub 연동 시 | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub 연동 시 | GitHub App private key (PEM, `\n` 이스케이프 가능) |
| `GITHUB_WEBHOOK_SECRET` | GitHub 연동 시 | webhook 서명 검증 secret |
| `GITHUB_CLIENT_ID` | GitHub 로그인 시 | OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub 로그인 시 | OAuth client secret |

GitHub 변수가 없어도 앱은 DEMO_MODE로 정상 동작한다.

## Render 배포

1. **Render Postgres** 인스턴스를 만들고 `DATABASE_URL`(internal URL 권장)을 확보한다.
2. **Render Web Service**를 만든다.
   - Repo: 이 저장소
   - Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm build && pnpm db:generate`
   - Pre-deploy(또는 start 앞단): `pnpm db:migrate`
   - Start command: `pnpm start` (= `tsx apps/api/src/index.ts`, 웹 정적 파일 포함 서빙)
   - 환경변수: 위 표 참조. `APP_URL`은 Render가 준 도메인으로.
3. GitHub App webhook URL을 `https://<앱 도메인>/api/github/webhook`으로 설정한다.
   (GitHub App 생성은 `docs/github-app-setup.md` 참조)
4. 트래픽 증가 시 **Background Worker** 서비스를 추가한다.
   - Start command: `pnpm worker`
   - Web Service에 `INLINE_WORKER=false` 설정

## 문제 해결

- `prisma generate` 실패: `pnpm db:generate`를 다시 실행. pnpm 10은 빌드 스크립트 승인이
  필요할 수 있다 (`pnpm approve-builds`). 루트 `package.json`의 `pnpm.onlyBuiltDependencies`에
  prisma 관련 패키지가 이미 등록되어 있다.
- 웹에서 401: 세션 쿠키가 없는 상태. 로그인(데모 또는 GitHub) 후 다시 시도.
- MCP 401: 토큰이 폐기되었거나 잘못됨. 설정 화면에서 토큰을 재발급.
