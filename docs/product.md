# VibeTrack 제품 정의

## 한 줄 정의

VibeTrack은 Claude Code 같은 AI 코딩 에이전트와 GitHub에 흩어진 작업 흔적을 모아,
**현재 프로젝트에서 무엇이 구현됐고, 무엇이 검증되지 않았으며, 다음에 무엇을 해야 하는지**
보여주는 프로젝트 기억 서비스다.

핵심은 "할 일 관리"가 아니라 **"AI가 만든 프로젝트의 실제 상태 추적"**이다.

## 사용자 문제

AI 코딩 에이전트로 프로젝트를 만드는 개인 개발자는 다음 문제를 겪는다.

1. **기억이 사람에게만 있다.** Claude Code 세션이 끝나면 "무엇을 만들었고 어디까지 검증했는지"가
   사라진다. 다음 세션마다 사용자가 현재 상태를 다시 설명해야 한다.
2. **구현과 검증이 구분되지 않는다.** AI가 "구현했다"고 말한 것과 실제로 커밋되고 테스트가
   통과한 것은 다르다. 어떤 기능이 실제 사용 가능한 상태인지 알기 어렵다.
3. **계획 문서가 없다.** 1인 개발자는 완벽한 스펙 문서를 만들지 않는다. 프로젝트의 기능 구조가
   어디에도 정리되어 있지 않다.
4. **다음 작업이 불명확하다.** 테스트가 깨진 기능, 검증 안 된 기능, 추적 안 된 변경이 쌓이면
   무엇부터 해야 할지 모른다.

## 대상 사용자 (V1)

- Claude Code를 사용하는 **1인 창업자 또는 개인 개발자**
- GitHub에 웹서비스 저장소가 있음
- 프로젝트 계획을 완벽하게 문서화하지 않음
- AI에게 여러 번 작업을 시켰지만 현재 상태를 다시 설명하기 힘듦

## 핵심 사용자 흐름

### A. 기존 GitHub 프로젝트 시작 (온보딩)

1. 사용자가 GitHub로 로그인한다. (DEMO_MODE에서는 데모 로그인)
2. "GitHub 저장소 연결"을 누르고 GitHub App 설치 후 추적할 저장소와 기본 브랜치를 고른다.
3. "Claude Code 연결" 화면에서 VibeTrack MCP endpoint URL과 프로젝트 연결 토큰을 받는다.
4. 사용자는 Claude Code에 제공된 **초기 분석 프롬프트**를 한 번 실행한다.
5. Claude Code가 저장소를 읽고 MCP의 `bootstrap_project_map` 도구를 호출한다.
6. VibeTrack은 기능 트리 **초안(DRAFT)** 을 생성한다.
7. 사용자는 웹에서 기능 트리를 검토하고 승인한다. 승인해야 ACTIVE가 된다.
8. 이후부터 Claude Code 작업이 자동으로 기록된다.

### B. 평소 작업 흐름

1. 사용자가 Claude Code에 작업을 요청한다.
2. Claude Code가 `get_project_context` / `get_feature_context`로 현재 맥락을 조회한다.
3. Claude Code가 코드를 수정하고 테스트를 실행한다.
4. Claude Code가 `record_work_update`를 호출해 작업 결과를 기록한다.
5. GitHub push / PR / CI 이벤트가 webhook으로 들어온다.
6. VibeTrack이 실제 변경 파일과 테스트 결과를 기능 증거로 연결한다.
7. 대시보드에 기능 상태와 검증 상태가 갱신된다.

### C. 기능 구조가 바뀌는 경우

새 기능 생성, 기능 종료, 이름 변경, 이동, 병합, 분리, 대체는 **자동 반영되지 않는다.**

1. Claude Code가 `propose_structure_change`를 호출한다.
2. VibeTrack은 "승인 대기(PENDING)" 제안을 만들고 Inbox에 넣는다.
3. 사용자는 Inbox에서 승인, 수정, 거절 중 하나를 선택한다.
4. 승인된 경우에만 기능 트리가 새 버전으로 갱신된다.

## 제품 원칙

1. 사용자는 기능 트리를 처음부터 직접 만들지 않는다. AI가 만든 초안을 검토·승인한다.
2. 평소 작업 기록은 Claude Code가 MCP를 통해 자동으로 남긴다.
3. 코드 변경 사실은 GitHub가 검증한다. GitHub는 증거 시스템이다.
4. 구조 변경만 사용자가 승인한다. 기존 기능의 기록/증거/테스트 결과는 자동 반영한다.
5. 기능 상태를 "73% 완료" 같은 애매한 숫자로 보여주지 않는다.
6. 파일 트리와 기능 트리를 절대 동일하게 취급하지 않는다. 파일은 증거일 뿐이다.
7. 기능은 고정 ID를 가진다. 파일 경로 변경이나 리팩터링으로 기능이 사라지면 안 된다.
8. 기능 삭제는 DB 삭제가 아니라 종료(RETIRED) 처리다.
9. VibeTrack 자체 LLM을 기본 기능에 사용하지 않는다. 판단은 사용자의 Claude Code가 한다.
10. 모바일(390px)에서도 현재 상태와 다음 작업을 바로 볼 수 있어야 한다.

## 기능 상태 구조

기능 하나는 단일 퍼센트가 아니라 세 가지 축으로 관리한다.

| 축 | 값 |
| --- | --- |
| 생명주기 (lifecycle) | DRAFT(초안) / ACTIVE(활성) / RETIRED(종료됨) |
| 구현 상태 (implementationStatus) | NOT_STARTED(미구현) / PARTIAL(일부 구현) / IMPLEMENTED(구현됨) / CHANGED(최근 변경됨) |
| 검증 상태 (verificationStatus) | UNKNOWN(확인 없음) / NEEDS_VERIFICATION(검증 필요) / PASSED(테스트 통과) / FAILED(테스트 실패) / MANUAL_VERIFIED(실제 사용 확인) |

사용자에게는 조합된 간단한 상태 문구로 보여준다.

- 계획됨 / 작업 중 / 구현됨 / 검증 필요 / 문제 있음 / 승인 대기 / 종료됨

## V1 범위

- GitHub 저장소 1개 연결 (GitHub App + webhook)
- Remote MCP endpoint (Streamable HTTP) + 프로젝트 범위 Bearer 토큰
- MCP 도구 6개: `get_project_context`, `get_feature_context`, `bootstrap_project_map`,
  `record_work_update`, `propose_structure_change`, `get_next_task`
- 웹 대시보드: 온보딩, 대시보드, 기능 지도, 기능 상세, Inbox, 활동 기록, 연결/설정
- 규칙 기반 다음 작업 추천 (LLM 미사용)
- DEMO_MODE: 실제 GitHub 자격증명 없이 전체 흐름 체험 가능

## 제외 범위 (V1에서 하지 않는 것)

- 팀 협업 및 역할별 권한
- Jira/Notion 대체
- 여러 IDE 완벽 지원
- VibeTrack 자체 LLM의 전체 코드 분석
- 자동 배포 관리
- 복잡한 일정 관리
- 결제/구독

## MVP 성공 기준

1. 사용자가 GitHub 저장소 하나를 연결할 수 있다.
2. 사용자가 Claude Code에 MCP를 연결할 수 있다.
3. Claude Code가 초기 기능 트리를 VibeTrack에 등록할 수 있다.
4. 사용자가 기능 트리를 승인할 수 있다.
5. Claude Code 작업 결과가 자동으로 기능 타임라인에 남는다.
6. 새 기능 생성 제안은 자동 반영되지 않고 Inbox에 표시된다.
7. GitHub 커밋과 변경 파일이 기능 증거로 연결된다.
8. 테스트 결과가 기능 검증 상태에 반영된다.
9. 모바일 화면에서도 프로젝트 상태와 다음 작업이 읽기 쉽다.
10. VibeTrack 자체 LLM 호출 없이 핵심 흐름이 작동한다.
