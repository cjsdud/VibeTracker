# VibeTracker 개발 가이드

pnpm monorepo. 주요 명령: `pnpm typecheck` / `pnpm lint` / `pnpm test`(Postgres 필요) /
`pnpm build`(웹 빌드). 서버는 빌드 없이 tsx로 실행한다. 구조와 원칙은 `docs/architecture.md`,
`docs/product.md` 참조.

## VibeTrack 작업 규칙

이 프로젝트는 VibeTrack MCP로 상태를 추적한다. 반드시 지켜라.
이 프로젝트의 VibeTrack projectId: `cmr9ba8si0001db4lppgv53pp` (모든 vibetrack 도구 호출에 사용)

1. 작업을 시작하면 먼저 `get_project_context`로 복귀 브리핑(경과 시간, 지난 작업,
   검증 필요 기능, 최근 코드 변경, 문제 있음)을 조회한다.
   (SessionStart 훅이 이미 브리핑을 주입했다면 다시 호출하지 않아도 된다)
2. 특정 기능을 건드릴 때는 `get_feature_context`로 그 기능의 파일/테스트/미해결 질문을 읽는다.
3. 작업을 마치기 전에 반드시 `record_work_update`를 호출한다.
   - 관련 featureIds, 작업 요약, 변경 파일 목록, 작업 커밋 SHA(commitShas)를 넣는다.
   - 기본 브랜치(main)가 아닌 브랜치에서 작업했다면 branch를 넣는다.
   - 테스트를 돌렸다면 그 결과(passed/failed)를 반드시 기록한다.
   - 해결 못한 문제는 openQuestions에 반드시 기록한다.
4. 새 기능 추가, 기능 삭제(종료), 병합, 분리, 이동, 이름 변경이 필요하면
   `propose_structure_change`를 호출한다. 기능 트리를 직접 임의로 수정하지 않는다.
   제안은 사용자가 VibeTrack Inbox에서 승인해야 반영된다.
5. 기능 지도가 아직 없거나 사용자가 지도 등록/재등록을 요청하면
   `bootstrap_project_map`을 사용한다 (도구 설명의 이름 규칙을 지켜라:
   비개발자가 읽고 이해하는 사용자 행동 중심 이름, 기능마다 한 줄 설명).
6. vibetrack MCP 서버가 연결되어 있지 않으면 위 규칙은 건너뛰고 평소처럼 작업한다.
