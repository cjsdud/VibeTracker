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
이 저장소 전체를 읽고 VibeTrack에 초기 기능 지도를 등록해라.

규칙:
- 파일 트리를 그대로 옮기지 마라. 사용자 관점의 기능 트리를 만들어라.
  (예: "로그인", "파일 업로드", "결과 요약" — "src/utils" 같은 폴더명 금지)
- 최상위는 3~6개 영역, 각 영역 아래에 구체 기능을 넣어라.
- 기능마다 증거를 연결해라: 관련 파일 경로, 라우트, API 엔드포인트, 테스트 파일.
- 이미 구현된 것으로 보이는 기능은 implementationStatus를 IMPLEMENTED 또는 PARTIAL로,
  아닌 것은 NOT_STARTED로 표시해라.
- 핵심 기능(제품이 성립하는 데 필수)은 isCore를 true로 표시해라.
- 다 만들면 vibetrack MCP의 bootstrap_project_map 도구를 projectId "<프로젝트ID>",
  현재 git HEAD SHA와 함께 호출해라.
- 등록 후 나에게 "VibeTrack 웹에서 기능 지도를 검토하고 승인하세요"라고 알려라.
```

## 5. 연결 확인

- 설정 화면의 "연결 상태"는 해당 프로젝트 토큰으로 MCP 요청이 마지막으로 들어온 시각
  (`lastUsedAt`)을 보여준다.
- Claude Code에서 `/mcp` 명령으로 vibetrack 서버가 connected인지 확인할 수 있다.
- 첫 bootstrap 후 VibeTrack 웹 Inbox에 "기능 지도 검토" 항목이 생기면 성공이다.
