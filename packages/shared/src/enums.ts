/**
 * Prisma enum과 1:1로 대응하는 공용 enum.
 * 웹(브라우저)이 Prisma client를 의존하지 않도록 여기에 별도로 정의한다.
 */

export const Lifecycle = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  RETIRED: 'RETIRED',
} as const;
export type Lifecycle = (typeof Lifecycle)[keyof typeof Lifecycle];

export const ImplementationStatus = {
  NOT_STARTED: 'NOT_STARTED',
  PARTIAL: 'PARTIAL',
  IMPLEMENTED: 'IMPLEMENTED',
  CHANGED: 'CHANGED',
} as const;
export type ImplementationStatus = (typeof ImplementationStatus)[keyof typeof ImplementationStatus];

export const VerificationStatus = {
  UNKNOWN: 'UNKNOWN',
  NEEDS_VERIFICATION: 'NEEDS_VERIFICATION',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  MANUAL_VERIFIED: 'MANUAL_VERIFIED',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const ProposalType = {
  CREATE: 'CREATE',
  RETIRE: 'RETIRE',
  RENAME: 'RENAME',
  MOVE: 'MOVE',
  MERGE: 'MERGE',
  SPLIT: 'SPLIT',
  REPLACE: 'REPLACE',
} as const;
export type ProposalType = (typeof ProposalType)[keyof typeof ProposalType];

export const ProposalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const EvidenceType = {
  FILE: 'FILE',
  ROUTE: 'ROUTE',
  API_ENDPOINT: 'API_ENDPOINT',
  TEST: 'TEST',
  COMMIT: 'COMMIT',
  PULL_REQUEST: 'PULL_REQUEST',
  DOCUMENT: 'DOCUMENT',
  WORK_UPDATE: 'WORK_UPDATE',
} as const;
export type EvidenceType = (typeof EvidenceType)[keyof typeof EvidenceType];

export const RelationType = {
  MERGED_INTO: 'MERGED_INTO',
  SPLIT_FROM: 'SPLIT_FROM',
  REPLACED_BY: 'REPLACED_BY',
} as const;
export type RelationType = (typeof RelationType)[keyof typeof RelationType];

export const InboxItemType = {
  FEATURE_MAP_REVIEW: 'FEATURE_MAP_REVIEW',
  STRUCTURE_PROPOSAL: 'STRUCTURE_PROPOSAL',
  UNTRACKED_CHANGE: 'UNTRACKED_CHANGE',
  EVIDENCE_MISMATCH: 'EVIDENCE_MISMATCH',
  TEST_FAILURE: 'TEST_FAILURE',
} as const;
export type InboxItemType = (typeof InboxItemType)[keyof typeof InboxItemType];

export const InboxItemStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type InboxItemStatus = (typeof InboxItemStatus)[keyof typeof InboxItemStatus];

export const VerificationSource = {
  CI: 'CI',
  MCP: 'MCP',
  MANUAL: 'MANUAL',
} as const;
export type VerificationSource = (typeof VerificationSource)[keyof typeof VerificationSource];

export const VerificationOutcome = {
  PASSED: 'PASSED',
  FAILED: 'FAILED',
} as const;
export type VerificationOutcome = (typeof VerificationOutcome)[keyof typeof VerificationOutcome];

export const JobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const WorkUpdateSource = {
  MCP: 'MCP',
  GITHUB: 'GITHUB',
  USER: 'USER',
} as const;
export type WorkUpdateSource = (typeof WorkUpdateSource)[keyof typeof WorkUpdateSource];

/** 상태 전이/활동 기록의 출처 — 트리 신뢰도 디버깅용 */
export const ChangeSource = {
  GITHUB_WEBHOOK: 'GITHUB_WEBHOOK',
  MCP_RECORD: 'MCP_RECORD',
  USER_MANUAL: 'USER_MANUAL',
} as const;
export type ChangeSource = (typeof ChangeSource)[keyof typeof ChangeSource];

export const TreeVersionCause = {
  BOOTSTRAP_APPROVED: 'BOOTSTRAP_APPROVED',
  PROPOSAL_APPLIED: 'PROPOSAL_APPLIED',
  MANUAL_EDIT: 'MANUAL_EDIT',
} as const;
export type TreeVersionCause = (typeof TreeVersionCause)[keyof typeof TreeVersionCause];

export const QuestionStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
} as const;
export type QuestionStatus = (typeof QuestionStatus)[keyof typeof QuestionStatus];
