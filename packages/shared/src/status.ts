import { type ImplementationStatus, type Lifecycle, type VerificationStatus } from './enums.js';

/**
 * 사용자에게 보여주는 조합 상태.
 * 퍼센트 진행률 대신 사람이 이해 가능한 한 가지 문구로 요약한다.
 *
 * 멘탈 모델:
 * - 완성(IMPLEMENTED): 구현이 끝나고 검증(테스트 통과/실사용 확인)까지 마침
 * - 검증 필요(NEEDS_VERIFICATION): 구현은 됐지만 아직 확인이 없음 — "부족한 부분"
 * - 작업 중(IN_PROGRESS): 일부만 구현됨
 * - 계획됨(PLANNED): 아직 시작 전
 * - 문제 있음(BROKEN): 최근 테스트 실패
 */
export type DisplayStatus =
  | 'PLANNED' // 계획됨
  | 'IN_PROGRESS' // 작업 중
  | 'IMPLEMENTED' // 완성 (구현 + 검증 완료)
  | 'NEEDS_VERIFICATION' // 검증 필요 (구현됐지만 미확인)
  | 'BROKEN' // 문제 있음
  | 'AWAITING_APPROVAL' // 승인 대기 (DRAFT)
  | 'RETIRED'; // 종료됨

export function deriveDisplayStatus(node: {
  lifecycle: Lifecycle;
  implementationStatus: ImplementationStatus;
  verificationStatus: VerificationStatus;
}): DisplayStatus {
  if (node.lifecycle === 'RETIRED') return 'RETIRED';
  if (node.lifecycle === 'DRAFT') return 'AWAITING_APPROVAL';
  if (node.verificationStatus === 'FAILED') return 'BROKEN';
  if (node.implementationStatus === 'NOT_STARTED') return 'PLANNED';
  if (node.implementationStatus === 'PARTIAL') return 'IN_PROGRESS';
  // IMPLEMENTED 또는 CHANGED: 검증 여부가 "완성"과 "검증 필요"를 가른다
  if (node.verificationStatus === 'PASSED' || node.verificationStatus === 'MANUAL_VERIFIED') {
    return 'IMPLEMENTED';
  }
  return 'NEEDS_VERIFICATION';
}

export const displayStatusLabelKo: Record<DisplayStatus, string> = {
  PLANNED: '계획됨',
  IN_PROGRESS: '작업 중',
  IMPLEMENTED: '완성',
  NEEDS_VERIFICATION: '검증 필요',
  BROKEN: '문제 있음',
  AWAITING_APPROVAL: '승인 대기',
  RETIRED: '종료됨',
};

/** 상태가 무엇을 뜻하는지 (범례/툴팁용) */
export const displayStatusDescriptionKo: Record<DisplayStatus, string> = {
  PLANNED: '아직 시작하지 않은 기능',
  IN_PROGRESS: '일부만 구현된 기능',
  IMPLEMENTED: '구현이 끝나고 테스트 통과 또는 실사용 확인까지 마친 기능',
  NEEDS_VERIFICATION: '구현은 됐지만 아직 테스트나 실사용 확인이 없는 기능',
  BROKEN: '최근 테스트가 실패한 기능',
  AWAITING_APPROVAL: '기능 지도 승인을 기다리는 초안',
  RETIRED: '종료된 기능 — 기록은 보존됩니다',
};

/** 이 상태에서 사용자가 다음에 하면 좋은 행동 */
export const displayStatusActionKo: Partial<Record<DisplayStatus, string>> = {
  BROKEN: '실패한 테스트부터 고치세요. Claude Code에서 get_next_task가 이 기능을 최우선으로 안내합니다.',
  NEEDS_VERIFICATION:
    'Claude Code에 "이 기능 테스트해줘" 또는 직접 실행해 확인한 뒤 기록을 남기면 완성으로 바뀝니다.',
  IN_PROGRESS: '이어서 구현을 진행하세요.',
  PLANNED: '구현을 시작할 차례입니다.',
  AWAITING_APPROVAL: '기능 지도 화면에서 초안을 검토하고 승인하세요.',
};

export const lifecycleLabelKo: Record<Lifecycle, string> = {
  DRAFT: '초안',
  ACTIVE: '활성',
  RETIRED: '종료됨',
};

export const implementationLabelKo: Record<ImplementationStatus, string> = {
  NOT_STARTED: '미구현',
  PARTIAL: '일부 구현',
  IMPLEMENTED: '구현됨',
  CHANGED: '최근 변경됨',
};

export const verificationLabelKo: Record<VerificationStatus, string> = {
  UNKNOWN: '확인 없음',
  NEEDS_VERIFICATION: '검증 필요',
  PASSED: '테스트 통과',
  FAILED: '테스트 실패',
  MANUAL_VERIFIED: '실제 사용 확인',
};

// ---------- 진행 요약 (퍼센트 없이 개수로) ----------

interface TreeLike {
  displayStatus: DisplayStatus;
  lifecycle: Lifecycle;
  children: TreeLike[];
}

export interface StatusSummary {
  /** 종료 제외 leaf 기능 수 */
  total: number;
  /** 완성(구현+검증) 기능 수 */
  done: number;
  counts: Record<DisplayStatus, number>;
}

/** 진행 바/요약에 쓰는 표시 순서 (완성 → 검증 필요 → 작업 중 → 계획 → 문제 → 승인 대기) */
export const summaryOrder: DisplayStatus[] = [
  'IMPLEMENTED',
  'NEEDS_VERIFICATION',
  'IN_PROGRESS',
  'PLANNED',
  'BROKEN',
  'AWAITING_APPROVAL',
];

/**
 * 서브트리의 leaf 기능(하위가 없는 실제 기능)들을 상태별로 집계한다.
 * 영역(부모) 노드 자체는 세지 않고, 종료된 기능도 제외한다.
 */
export function summarizeFeatures(nodes: TreeLike[]): StatusSummary {
  const counts: Record<DisplayStatus, number> = {
    PLANNED: 0,
    IN_PROGRESS: 0,
    IMPLEMENTED: 0,
    NEEDS_VERIFICATION: 0,
    BROKEN: 0,
    AWAITING_APPROVAL: 0,
    RETIRED: 0,
  };
  const walk = (list: TreeLike[]): void => {
    for (const node of list) {
      if (node.lifecycle === 'RETIRED') continue;
      if (node.children.filter((c) => c.lifecycle !== 'RETIRED').length > 0) {
        walk(node.children);
      } else {
        counts[node.displayStatus] += 1;
      }
    }
  };
  walk(nodes);
  const total = summaryOrder.reduce((sum, key) => sum + counts[key], 0);
  return { total, done: counts.IMPLEMENTED, counts };
}
