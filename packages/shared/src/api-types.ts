import {
  type EvidenceType,
  type ImplementationStatus,
  type InboxItemStatus,
  type InboxItemType,
  type Lifecycle,
  type ProposalStatus,
  type ProposalType,
  type VerificationOutcome,
  type VerificationSource,
  type VerificationStatus,
  type WorkUpdateSource,
} from './enums.js';
import { type DisplayStatus } from './status.js';

/** API 오류 응답 공통 형식 */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface UserDto {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  isDemo: boolean;
}

export interface ProjectDto {
  id: string;
  name: string;
  goal: string | null;
  createdAt: string;
  repository: RepositoryDto | null;
  counts?: DashboardCounts;
}

export interface RepositoryDto {
  id: string;
  fullName: string;
  defaultBranch: string;
  connected: boolean;
}

export interface DashboardCounts {
  coreFeatures: number;
  activeFeatures: number;
  needsVerification: number;
  pendingProposals: number;
  untrackedChanges: number;
  openQuestions: number;
  draftFeatures: number;
}

export interface NextTaskDto {
  kind:
    | 'FIX_FAILING_TESTS'
    | 'VERIFY_CORE_FEATURE'
    | 'REVIEW_PROPOSALS'
    | 'REVIEW_UNTRACKED_CHANGES'
    | 'RESOLVE_OPEN_QUESTIONS'
    | 'IMPLEMENT_CORE_FEATURE'
    | 'REVIEW_FEATURE_MAP'
    | 'ALL_CLEAR';
  task: string;
  reason: string;
  featureIds: string[];
  instruction: string;
}

export interface FeatureNodeDto {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  isCore: boolean;
  orderIndex: number;
  lifecycle: Lifecycle;
  implementationStatus: ImplementationStatus;
  verificationStatus: VerificationStatus;
  displayStatus: DisplayStatus;
  lastChangedAt: string | null;
  children: FeatureNodeDto[];
}

export interface FeatureEvidenceDto {
  id: string;
  type: EvidenceType;
  path: string | null;
  ref: string | null;
  title: string | null;
  url: string | null;
  createdAt: string;
  missing: boolean;
}

export interface WorkUpdateDto {
  id: string;
  source: WorkUpdateSource;
  summary: string;
  changedFiles: string[];
  gitHeadSha: string | null;
  testsStatus: 'PASSED' | 'FAILED' | 'NOT_RUN' | null;
  testsSummary: string | null;
  manualCheck: boolean;
  nextTask: string | null;
  createdAt: string;
  featureIds: string[];
  featureNames: string[];
}

export interface OpenQuestionDto {
  id: string;
  question: string;
  status: 'OPEN' | 'RESOLVED';
  featureNodeId: string | null;
  createdAt: string;
}

export interface VerificationRunDto {
  id: string;
  source: VerificationSource;
  status: VerificationOutcome;
  name: string | null;
  commitSha: string | null;
  featureNodeId: string | null;
  createdAt: string;
}

export interface FeatureDetailDto {
  node: Omit<FeatureNodeDto, 'children'>;
  parentName: string | null;
  evidence: FeatureEvidenceDto[];
  workUpdates: WorkUpdateDto[];
  openQuestions: OpenQuestionDto[];
  verificationRuns: VerificationRunDto[];
  relatedProposals: ChangeProposalDto[];
}

export interface ChangeProposalDto {
  id: string;
  type: ProposalType;
  status: ProposalStatus;
  title: string;
  reason: string;
  targetFeatureIds: string[];
  targetFeatureNames: string[];
  payload: unknown;
  source: WorkUpdateSource;
  createdAt: string;
  decidedAt: string | null;
}

export interface InboxItemDto {
  id: string;
  type: InboxItemType;
  status: InboxItemStatus;
  title: string;
  detail: unknown;
  changeProposal: ChangeProposalDto | null;
  featureNodeId: string | null;
  createdAt: string;
}

export interface GithubEventDto {
  id: string;
  eventType: string;
  action: string | null;
  summary: string;
  receivedAt: string;
  status: string;
}

export interface ActivityItemDto {
  id: string;
  kind: 'WORK_UPDATE' | 'GITHUB_EVENT' | 'VERIFICATION_RUN' | 'AUDIT';
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface McpTokenDto {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** 발급 직후 응답에만 포함되는 평문 토큰. 다시 조회할 수 없다. */
  plaintext?: string;
}

export interface ClaudeSetupDto {
  mcpUrl: string;
  projectId: string;
  hasActiveToken: boolean;
  lastMcpActivityAt: string | null;
  mcpJsonExample: string;
  claudeMdExample: string;
  bootstrapPrompt: string;
  historyImportPrompt: string;
  addCommandExample: string;
}
