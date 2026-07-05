# GitHub App 설정 가이드

VibeTrack은 GitHub App으로 저장소 이벤트(push, PR, CI)를 받고 저장소 목록을 조회한다.
실제 자격증명이 없으면 DEMO_MODE로 동작하므로, 이 문서는 실제 연동 시에만 필요하다.

## 1. GitHub App 생성

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**

- **App name**: `vibetrack-<본인 식별자>` (전역 유일해야 함)
- **Homepage URL**: `https://<앱 도메인>` (`APP_URL`과 동일)
- **Callback URL**: `https://<앱 도메인>/api/auth/github/callback`
  - "Request user authorization (OAuth) during installation" 체크
- **Webhook URL**: `https://<앱 도메인>/api/github/webhook`
- **Webhook secret**: 무작위 문자열 생성 → `GITHUB_WEBHOOK_SECRET`

## 2. 권한 (Repository permissions)

| 권한          | 수준      | 용도                |
| ------------- | --------- | ------------------- |
| Contents      | Read-only | 커밋/파일 변경 확인 |
| Metadata      | Read-only | 저장소 기본 정보    |
| Pull requests | Read-only | PR 이벤트           |
| Checks        | Read-only | check_run 결과      |
| Actions       | Read-only | workflow_run 결과   |

## 3. 이벤트 구독 (Subscribe to events)

- `Push`
- `Pull request`
- `Check run`
- `Workflow run`
- `Installation` (설치/삭제 추적)

## 4. 키 발급

- App 생성 후 **Generate a private key** → PEM 파일 다운로드
- 환경변수 설정:

```bash
GITHUB_APP_ID=123456
# PEM은 줄바꿈을 \n으로 이스케이프해서 한 줄로 넣어도 된다 (앱이 복원함)
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<위에서 만든 secret>
GITHUB_CLIENT_ID=<App의 Client ID>
GITHUB_CLIENT_SECRET=<App에서 생성한 Client secret>
```

## 5. 설치

- App 페이지 → **Install App** → 추적할 저장소만 선택 설치
- VibeTrack 설정 화면에서 "GitHub 연결"을 누르면 설치된 저장소 목록이 보이고,
  저장소와 기본 브랜치를 선택해 프로젝트에 연결한다.

## 6. 확인

- 저장소에 push → VibeTrack 활동 기록에 커밋이 나타나는지 확인
- 서명 불일치 요청은 401로 거부된다
- 같은 delivery ID 재전송(GitHub webhook redeliver)은 중복 처리되지 않는다
