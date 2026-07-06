# VibeTracker 개발 가이드

pnpm monorepo. 주요 명령: `pnpm typecheck` / `pnpm lint` / `pnpm test`(Postgres 필요) /
`pnpm build`(웹 빌드). 서버는 빌드 없이 tsx로 실행한다. 구조와 원칙은 `docs/architecture.md`,
`docs/product.md` 참조.

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
6. vibetrack MCP 서버가 연결되어 있지 않으면 위 규칙은 건너뛰고 평소처럼 작업한다.
