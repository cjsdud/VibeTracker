import { type ImplementationStatus, type Lifecycle, type VerificationStatus } from './enums.js';

/**
 * 사용자에게 보여주는 조합 상태.
 * 퍼센트 진행률 대신 사람이 이해 가능한 한 가지 문구로 요약한다.
 */
export type DisplayStatus =
  | 'PLANNED' // 계획됨
  | 'IN_PROGRESS' // 작업 중
  | 'IMPLEMENTED' // 구현됨
  | 'NEEDS_VERIFICATION' // 검증 필요
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
  if (node.verificationStatus === 'NEEDS_VERIFICATION') return 'NEEDS_VERIFICATION';
  if (node.implementationStatus === 'PARTIAL') return 'IN_PROGRESS';
  // IMPLEMENTED 또는 CHANGED + (UNKNOWN/PASSED/MANUAL_VERIFIED)
  if (node.implementationStatus === 'CHANGED' && node.verificationStatus === 'UNKNOWN') {
    return 'NEEDS_VERIFICATION';
  }
  if (node.verificationStatus === 'UNKNOWN') return 'IN_PROGRESS';
  return 'IMPLEMENTED';
}

export const displayStatusLabelKo: Record<DisplayStatus, string> = {
  PLANNED: '계획됨',
  IN_PROGRESS: '작업 중',
  IMPLEMENTED: '구현됨',
  NEEDS_VERIFICATION: '검증 필요',
  BROKEN: '문제 있음',
  AWAITING_APPROVAL: '승인 대기',
  RETIRED: '종료됨',
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
