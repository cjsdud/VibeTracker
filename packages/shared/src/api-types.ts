import {
  type ChangeSource,
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
  /** 마지막 공식 상태 변경의 출처 (github_webhook / mcp_record / user_manual) */
  lastStatusSource: ChangeSource | null;
  /** 지도에 등록된 시각 — 히스토리 타임라인의 시작점 */
  createdAt: string;
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
  /** 작업 기록에서 생성된 증거면 그 기록의 ID — 타임라인에서 작업 기록과 중복 표시하지 않기 위해 */
  workUpdateId: string | null;
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

/** 기능별 "작업 중 변경"(브랜치 단위). 공식 상태(main 기준)와 분리된다. */
export interface BranchActivityDto {
  id: string;
  featureNodeId: string;
  branch: string;
  summary: string | null;
  lastCommitSha: string | null;
  prNumber: number | null;
  prState: string | null;
  ciFailed: boolean;
  source: ChangeSource;
  updatedAt: string;
}

export interface FeatureDetailDto {
  node: Omit<FeatureNodeDto, 'children'>;
  parentName: string | null;
  evidence: FeatureEvidenceDto[];
  workUpdates: WorkUpdateDto[];
  openQuestions: OpenQuestionDto[];
  verificationRuns: VerificationRunDto[];
  relatedProposals: ChangeProposalDto[];
  /** 공식 상태(node)와 별개인 브랜치별 작업 중 변경 */
  branchActivities: BranchActivityDto[];
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
  /** SessionStart 훅 설치 명령 (프로젝트 루트에서 1회 실행) */
  hookInstallCommand: string;
  /** 웹 클로드 코드용 원샷 설정 프롬프트 — 세션에 붙여넣으면 파일 생성·훅 설치·커밋까지 수행 */
  webSetupPrompt: string;
}

// ---------- 복귀 브리핑 ----------
// 원칙: 사실 나열만. "지금 이걸 하라" 같은 추천/판단 문장을 만들지 않는다.
// 사실은 틀릴 수 없지만 추천은 틀릴 수 있고, 틀린 추천은 브리핑 전체의 신뢰를 깎는다.

export interface BriefingRecentWorkItem {
  summary: string;
  featureNames: string[];
  testsStatus: 'PASSED' | 'FAILED' | 'NOT_RUN' | null;
  occurredAt: string;
  source: WorkUpdateSource;
}

export interface BriefingUnmergedBranch {
  branch: string;
  featureNames: string[];
  prNumber: number | null;
  prState: string | null;
  ciFailed: boolean;
  updatedAt: string;
}

export interface BriefingDto {
  project: { id: string; name: string; goal: string | null };
  repository: { fullName: string; defaultBranch: string } | null;
  generatedAt: string;
  /** 1. 경과 시간 */
  elapsed: {
    lastWorkRecordAt: string | null;
    lastCommitAt: string | null;
    daysSinceLastActivity: number | null;
  };
  /** 2. 지난 작업 요약 — MCP 기록 기반, 없으면 커밋 메시지 폴백 */
  recentWork: {
    basis: 'WORK_RECORDS' | 'COMMITS' | 'NONE';
    items: BriefingRecentWorkItem[];
  };
  /** 3. 검증 필요 상태인 기능 (사실 나열) */
  needsVerification: { id: string; name: string; isCore: boolean }[];
  /** 4. 최근 코드 변경 */
  recentCodeChanges: {
    windowDays: number;
    defaultBranchCommitCount: number;
    latestCi: { status: 'PASSED' | 'FAILED'; name: string | null; at: string } | null;
    unmergedBranches: BriefingUnmergedBranch[];
  };
  /** 5. 문제 있음 상태인 기능 + 연결된 미해결 질문 */
  broken: { id: string; name: string; isCore: boolean; openQuestions: string[] }[];
  /** 사람이 읽는 요약 텍스트 (대시보드/SessionStart 훅에서 재사용) */
  briefingText: string;
}
