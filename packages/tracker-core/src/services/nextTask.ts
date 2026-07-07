import { type NextTaskDto } from '@vibetrack/shared';
import { type Db } from '../db.js';
import { needsVerificationWhere } from './predicates.js';

/**
 * get_next_task: 규칙 기반으로 지금 가장 우선인 작업 1개를 고른다. LLM을 쓰지 않는다.
 *
 * 우선순위:
 * 1. 테스트 실패 기능
 * 2. 핵심 기능 검증 필요
 * 3. 승인 대기 구조 변경
 * 4. 추적되지 않은 코드 변경
 * 5. 미해결 질문이 많은 기능
 * 6. 미구현 핵심 기능
 */
export async function getNextTask(db: Db, projectId: string): Promise<NextTaskDto> {
  // 0. 초안 지도가 승인 대기 중이면 그것부터
  const draftReview = await db.inboxItem.findFirst({
    where: { projectId, type: 'FEATURE_MAP_REVIEW', status: 'OPEN' },
  });
  if (draftReview) {
    return {
      kind: 'REVIEW_FEATURE_MAP',
      task: '초기 기능 지도를 검토하고 승인하세요',
      reason: 'Claude Code가 등록한 기능 지도 초안이 승인 대기 중입니다.',
      featureIds: [],
      instruction:
        '사용자에게 VibeTrack 웹의 기능 지도 화면에서 초안을 검토하고 승인해 달라고 요청하세요. 승인 전에는 작업 기록이 기능과 연결되지 않습니다.',
    };
  }

  // 1. 테스트 실패
  const failing = await db.featureNode.findFirst({
    where: { projectId, lifecycle: 'ACTIVE', verificationStatus: 'FAILED' },
    orderBy: [{ isCore: 'desc' }, { lastChangedAt: 'desc' }],
  });
  if (failing) {
    return {
      kind: 'FIX_FAILING_TESTS',
      task: `"${failing.name}" 기능의 실패한 테스트를 고치세요`,
      reason: '테스트가 실패한 기능은 다른 어떤 작업보다 우선입니다.',
      featureIds: [failing.id],
      instruction: `get_feature_context로 기능 "${failing.name}"(${failing.id})의 실패한 테스트와 관련 파일을 확인하고, 테스트를 통과시킨 뒤 record_work_update로 결과를 기록하세요.`,
    };
  }

  // 2. 핵심 기능 검증 필요 (표시 상태의 "검증 필요"와 같은 정의:
  //    구현됐지만 아직 확인 없음 — bootstrap 직후의 UNKNOWN도 포함)
  const needsVerify = await db.featureNode.findFirst({
    where: { projectId, isCore: true, ...needsVerificationWhere },
    orderBy: { lastChangedAt: 'desc' },
  });
  if (needsVerify) {
    return {
      kind: 'VERIFY_CORE_FEATURE',
      task: `"${needsVerify.name}" 기능을 검증하세요`,
      reason: '최근 변경된 핵심 기능이 아직 검증되지 않았습니다.',
      featureIds: [needsVerify.id],
      instruction: `기능 "${needsVerify.name}"(${needsVerify.id})의 테스트를 실행하거나 실제 동작을 확인하고, record_work_update에 tests 또는 manualCheck 결과를 기록하세요.`,
    };
  }

  // 3. 승인 대기 구조 변경
  const pendingProposals = await db.changeProposal.count({
    where: { projectId, status: 'PENDING' },
  });
  if (pendingProposals > 0) {
    return {
      kind: 'REVIEW_PROPOSALS',
      task: `승인 대기 중인 구조 변경 제안 ${pendingProposals}건을 처리하세요`,
      reason: '구조 변경이 승인되기 전까지 기능 트리가 실제 상태와 어긋납니다.',
      featureIds: [],
      instruction:
        '사용자에게 VibeTrack Inbox에서 대기 중인 구조 변경 제안을 승인하거나 거절해 달라고 요청하세요.',
    };
  }

  // 4. 추적되지 않은 코드 변경
  const untracked = await db.inboxItem.count({
    where: { projectId, type: 'UNTRACKED_CHANGE', status: 'OPEN' },
  });
  if (untracked > 0) {
    return {
      kind: 'REVIEW_UNTRACKED_CHANGES',
      task: `추적되지 않은 변경 ${untracked}건을 기능과 연결하세요`,
      reason: '어떤 기능에도 연결되지 않은 코드 변경이 있습니다. 상태 추적에 구멍이 생깁니다.',
      featureIds: [],
      instruction:
        'get_project_context로 기능 트리를 확인한 뒤, 추적되지 않은 변경이 기존 기능에 속하면 record_work_update로 연결하고, 새 기능이면 propose_structure_change로 제안하세요.',
    };
  }

  // 5. 미해결 질문이 많은 기능 (상위 그룹이 종료/초안 기능이면 다음 그룹으로 넘어간다)
  const questionGroups = await db.openQuestion.groupBy({
    by: ['featureNodeId'],
    where: { projectId, status: 'OPEN', featureNodeId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });
  for (const group of questionGroups) {
    if (!group.featureNodeId || group._count.id === 0) continue;
    const feature = await db.featureNode.findFirst({
      where: { id: group.featureNodeId, projectId, lifecycle: 'ACTIVE' },
    });
    if (feature) {
      return {
        kind: 'RESOLVE_OPEN_QUESTIONS',
        task: `"${feature.name}" 기능의 미해결 질문 ${group._count.id}개를 해결하세요`,
        reason: '미해결 질문이 가장 많이 쌓인 기능입니다.',
        featureIds: [feature.id],
        instruction: `get_feature_context로 기능 "${feature.name}"(${feature.id})의 미해결 질문을 읽고, 코드 확인이나 사용자 질문으로 답을 정한 뒤 record_work_update에 결과를 기록하세요.`,
      };
    }
  }

  // 6. 미구현 핵심 기능
  const notStarted = await db.featureNode.findFirst({
    where: { projectId, lifecycle: 'ACTIVE', isCore: true, implementationStatus: 'NOT_STARTED' },
    orderBy: { orderIndex: 'asc' },
  });
  if (notStarted) {
    return {
      kind: 'IMPLEMENT_CORE_FEATURE',
      task: `"${notStarted.name}" 기능을 구현하세요`,
      reason: '아직 시작하지 않은 핵심 기능입니다.',
      featureIds: [notStarted.id],
      instruction: `get_feature_context로 기능 "${notStarted.name}"(${notStarted.id})의 맥락을 확인하고 구현을 시작하세요. 완료 후 record_work_update로 결과를 기록하세요.`,
    };
  }

  return {
    kind: 'ALL_CLEAR',
    task: '급한 작업이 없습니다',
    reason: '실패한 테스트, 검증 대기, 승인 대기, 추적 안 된 변경이 모두 없습니다.',
    featureIds: [],
    instruction:
      '사용자에게 다음으로 만들고 싶은 기능을 물어보세요. 새 기능이라면 propose_structure_change로 먼저 제안하세요.',
  };
}
