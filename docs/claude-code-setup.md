# Claude Code 연결 가이드

VibeTrack 웹의 **설정 → Claude Code 연결** 화면에서 아래 내용이 프로젝트별 값으로 채워져
제공된다. 이 문서는 그 내용의 원본 설명이다.

## 1. MCP 연결 정보

- MCP endpoint: `https://<앱 도메인>/mcp` (Streamable HTTP)
- 인증: `Authorization: Bearer vtk_...` 프로젝트 연결 토큰
- 토큰은 설정 화면에서 발급하며 **발급 직후 한 번만 평문으로 표시**된다. 유출 시 폐기 후 재발급.

## 2. Claude Code에 MCP 등록

프로젝트 저장소에서:

```bash
claude mcp add --transport http vibetrack https://<앱 도메인>/mcp \
  --header "Authorization: Bearer vtk_xxxxxxxx"
```

또는 `.mcp.json`:

```json
{
  "mcpServers": {
    "vibetrack": {
      "type": "http",
      "url": "https://<앱 도메인>/mcp",
      "headers": {
        "Authorization": "Bearer vtk_xxxxxxxx"
      }
    }
  }
}
```

## 3. CLAUDE.md에 추가할 작업 규칙

```markdown
## VibeTrack 작업 규칙

이 프로젝트는 VibeTrack MCP로 상태를 추적한다. 반드시 지켜라.

1. 작업을 시작하면 먼저 `get_project_context`로 현재 프로젝트 맥락(기능 트리, 최근 작업,
   검증 필요 기능, 다음 우선 작업)을 조회한다.
2. 특정 기능을 건드릴 때는 `get_feature_context`로 그 기능의 파일/테스트/미해결 질문을 읽는다.
3. 작업을 마치기 전에 반드시 `record_work_update`를 호출한다.
   - 관련 featureIds, 작업 요약, 변경 파일 목록, 현재 git HEAD SHA를 넣는다.
   - 테스트를 돌렸다면 그 결과(passed/failed)를 반드시 기록한다.
   - 해결 못한 문제는 openQuestions에 반드시 기록한다.
4. 새 기능 추가, 기능 삭제(종료), 병합, 분리, 이동, 이름 변경이 필요하면
   `propose_structure_change`를 호출한다. 기능 트리를 직접 임의로 수정하지 않는다.
   제안은 사용자가 VibeTrack Inbox에서 승인해야 반영된다.
5. 무엇을 할지 모르겠으면 `get_next_task`로 현재 우선 작업 1개를 받아 수행한다.
```

## 4. 초기 기능 지도 생성 프롬프트 (bootstrap)

새 프로젝트를 연결한 뒤 Claude Code에서 **한 번** 실행한다:

```
이 저장소 전체를 읽고 VibeTrack에 기능 지도를 등록해라.

이 지도는 개발을 모르는 사람이 읽는다. 목적은 프로젝트 주인이 지도만 보고
"무엇이 만들어졌고, 무엇이 확인 안 됐고, 무엇이 남았는지"를 파악하는 것이다.

이름 규칙 (가장 중요):
- 모든 이름은 "사용자가 하는 일" 또는 "사용자 눈에 보이는 것"으로 지어라.
- 기술 용어 금지: API, MCP, webhook, 엔드포인트, DB, 스키마, 큐, 미들웨어,
  폴더/파일명. 기술 이름이 아니라 그 기술이 사용자에게 해주는 일을 써라.
  나쁜 예 → 좋은 예:
  - "MCP 엔드포인트" → "Claude Code에서 프로젝트 상태 읽고 쓰기"
  - "Webhook 수신과 서명 검증" → "GitHub 활동 자동 반영"
  - "사용자 접근" → "시작하기와 로그인"
- 사용자에게 직접 보이지 않는 내부 구성요소(큐, 캐시, 마이그레이션 등)는
  기능으로 만들지 마라. 그것이 지탱하는 사용자 기능의 evidence로만 연결해라.

구성 규칙:
- 최상위 영역은 3~6개, 사용자가 서비스를 접하는 순서대로 배치해라
  (시작하기 → 핵심 기능 → 부가 기능 순). 영역 이름도 행동 중심으로.
- 각 영역 아래 구체 기능 2~7개, 전체 15~30개가 적당하다.
- 모든 기능에 description 한 줄을 반드시 써라: "누가 무엇을 할 수 있다" 형식.

증거와 상태:
- 기능마다 evidence를 연결해라: 파일 경로, 라우트, API 엔드포인트, 테스트.
  (기술 정보는 이름이 아니라 여기에 넣는 것이다)
- 구현이 끝나 보이면 implementationStatus를 IMPLEMENTED, 일부만 있으면 PARTIAL,
  아직이면 NOT_STARTED로 표시해라.
- 제품이 성립하는 데 필수인 기능은 isCore를 true로 표시해라.

등록 절차:
- 등록 전에 각 이름을 읽고 자문해라: "개발을 모르는 사람이 이 이름만 보고
  무슨 기능인지 알겠는가?" 하나라도 아니면 고쳐라.
- 다 만들면 vibetrack MCP의 bootstrap_project_map 도구를 projectId "<프로젝트ID>",
  현재 git HEAD SHA와 함께 호출해라.
- 결과에 qualityWarnings가 있으면 지적된 이름/설명을 고쳐 같은 도구를 다시
  호출해라 (초안이 새 초안으로 교체된다).

지난 히스토리 연결 (기록이 있으면 반드시):
- 등록 직후 git log를 훑고, ~/.claude/projects/에 지난 Claude Code 세션 기록이
  있으면 그것도 함께 훑어라.
- 의미 있는 작업/커밋마다 record_work_update를 호출해 방금 등록한 기능들에
  연결해라. 반드시 occurredAt(그 작업의 실제 시각, ISO 8601)을 넣어라 —
  소급 기록은 타임라인만 남기고 현재 상태는 바꾸지 않는다.
- 승인 전 초안 기능에도 연결할 수 있고, 승인되면 그대로 유지된다.
  이렇게 해야 기능 지도에서 기능마다 "언제 무엇을 했는지"가 함께 보인다.

- 끝나면 나에게 "VibeTrack 웹에서 기능 지도를 검토하고 승인하세요"라고 알려라.
```

등록 결과에는 규칙 기반 `qualityWarnings`가 포함될 수 있다 (기술 용어 이름,
파일 경로 이름, 설명 없음, 영역 과다, 과도하게 긴 이름). Claude Code는 경고를
보고 이름/설명을 고쳐 재등록하며, 남은 경고는 웹 Inbox의 검토 항목에도 표시된다.

## 5. 지난 세션 기록 가져오기 (선택)

bootstrap 프롬프트가 히스토리 연결까지 지시하므로 보통은 따로 실행할 필요가 없다.
지도만 등록하고 히스토리를 건너뛴 경우, 설정 화면의 "지난 Claude Code 세션 기록
가져오기" 프롬프트를 **한 번** 실행하면 Claude Code가 `~/.claude/projects/`의
자기 세션 로그(.jsonl)를 읽고(없으면 git log의 커밋 단위로), 세션별 작업 요약·
변경 파일·미해결 질문을 `record_work_update`(+`occurredAt`)로 등록한다.
지도 승인 전 초안 기능에도 연결할 수 있으며 승인 후 그대로 유지된다.

- 소급 기록은 타임라인/증거/질문만 남기고 **현재 기능 상태는 바꾸지 않는다**
- 과거의 테스트 실패는 Inbox 알림을 만들지 않는다 (이미 해결됐을 수 있으므로)
- VibeTrack이 대화 로그를 직접 읽는 것이 아니라, 사용자의 Claude Code가 읽고 판단해서
  기록한다 (제품 원칙: VibeTrack 자체 LLM 없음)

## 6. 복귀 브리핑 자동 주입 (SessionStart 훅, 권장)

CLAUDE.md에 "세션 시작 시 get_project_context를 호출하라"고 적는 방식은 준수율이
보장되지 않는다. 설정 화면의 설치 명령을 프로젝트 루트에서 **한 번** 실행하면:

```bash
curl -fsSL https://<앱 도메인>/hook/install.mjs -o /tmp/vibetrack-install.mjs \
  && node /tmp/vibetrack-install.mjs
```

- `.claude/hooks/vibetrack-briefing.mjs`가 설치되고 `.claude/settings.json`에
  SessionStart 훅이 등록된다 (기존 설정 보존, 중복 등록 방지)
- 매 세션 시작 시 복귀 브리핑(경과 시간 · 지난 작업 요약 · 검증 필요 목록 ·
  최근 코드 변경 · 문제 있음 목록)이 세션 컨텍스트에 자동 주입된다
- 훅은 `.mcp.json`의 vibetrack 항목에서 서버 주소와 토큰을 읽는다 — 별도 시크릿 불필요
- 네트워크 오류·토큰 만료 등 어떤 실패에도 조용히 스킵한다 — 세션을 막지 않는다
- 브리핑은 사실 나열만 한다("검증 필요 상태인 기능: X, Y"). 무엇을 할지는
  브리핑을 받은 Claude Code가 세션 안에서 판단한다

## 7. 연결 확인

- 설정 화면의 "연결 상태"는 해당 프로젝트 토큰으로 MCP 요청이 마지막으로 들어온 시각
  (`lastUsedAt`)을 보여준다.
- Claude Code에서 `/mcp` 명령으로 vibetrack 서버가 connected인지 확인할 수 있다.
- 첫 bootstrap 후 VibeTrack 웹 Inbox에 "기능 지도 검토" 항목이 생기면 성공이다.
