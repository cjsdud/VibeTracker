import { z } from 'zod';

/**
 * MCP 도구 6개의 입력 스키마.
 * packages/mcp의 도구 등록과 tracker-core의 서비스 입력 검증에서 같은 스키마를 쓴다.
 */

export const getProjectContextInput = z.object({
  projectId: z.string().min(1).describe('VibeTrack 프로젝트 ID'),
  focusFeatureIds: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe('지금 작업하려는 기능 ID 목록 (있으면 해당 기능 맥락을 더 자세히 반환)'),
});
export type GetProjectContextInput = z.infer<typeof getProjectContextInput>;

export const getFeatureContextInput = z.object({
  projectId: z.string().min(1).describe('VibeTrack 프로젝트 ID'),
  featureId: z.string().min(1).describe('기능 ID'),
});
export type GetFeatureContextInput = z.infer<typeof getFeatureContextInput>;

const implementationStatusInput = z.enum(['NOT_STARTED', 'PARTIAL', 'IMPLEMENTED', 'CHANGED']);

const bootstrapEvidenceSchema = z.object({
  files: z.array(z.string().min(1)).max(200).optional().describe('관련 파일 경로'),
  routes: z.array(z.string().min(1)).max(50).optional().describe('관련 웹 라우트 (예: /login)'),
  apiEndpoints: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe('관련 API 엔드포인트 (예: POST /api/auth/login)'),
  tests: z.array(z.string().min(1)).max(100).optional().describe('관련 테스트 파일/이름'),
  documents: z.array(z.string().min(1)).max(50).optional().describe('관련 문서 경로'),
});
export type BootstrapEvidence = z.infer<typeof bootstrapEvidenceSchema>;

export interface BootstrapNodeInput {
  name: string;
  description?: string;
  isCore?: boolean;
  implementationStatus?: z.infer<typeof implementationStatusInput>;
  evidence?: BootstrapEvidence;
  children?: BootstrapNodeInput[];
}

const bootstrapNodeSchema: z.ZodType<BootstrapNodeInput> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(120).describe('사용자 관점의 기능 이름 (폴더/파일명 금지)'),
    description: z.string().max(2000).optional(),
    isCore: z.boolean().optional().describe('제품이 성립하는 데 필수인 핵심 기능이면 true'),
    implementationStatus: implementationStatusInput.optional(),
    evidence: bootstrapEvidenceSchema.optional(),
    children: z.array(bootstrapNodeSchema).max(50).optional(),
  }),
);

export const bootstrapProjectMapInput = z.object({
  projectId: z.string().min(1),
  baseCommitSha: z.string().min(7).max(64).optional().describe('분석 기준 git HEAD SHA'),
  projectGoal: z.string().max(2000).optional().describe('프로젝트 목표 한두 문장'),
  features: z.array(bootstrapNodeSchema).min(1).max(30).describe('최상위 기능 영역 목록'),
});
export type BootstrapProjectMapInput = z.infer<typeof bootstrapProjectMapInput>;

export const testResultSchema = z.object({
  status: z.enum(['PASSED', 'FAILED', 'NOT_RUN']).describe('전체 테스트 결과'),
  passed: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  summary: z.string().max(2000).optional().describe('테스트 결과 요약 (실패 시 실패 내용)'),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const recordWorkUpdateInput = z.object({
  projectId: z.string().min(1),
  featureIds: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe('이번 작업과 관련된 기능 ID 목록. 모르면 비워두면 untracked로 Inbox에 들어간다'),
  summary: z.string().min(1).max(4000).describe('작업 내용 요약'),
  changedFiles: z.array(z.string().min(1)).max(300).optional().describe('변경한 파일 경로 목록'),
  gitHeadSha: z.string().min(7).max(64).optional().describe('작업 종료 시점 git HEAD SHA'),
  implementationStatus: z
    .enum(['PARTIAL', 'IMPLEMENTED', 'CHANGED'])
    .optional()
    .describe('관련 기능의 구현 상태 갱신 (생략 시 자동: 미구현→일부 구현, 그 외→최근 변경됨)'),
  tests: testResultSchema.optional().describe('실행한 테스트 결과'),
  manualCheck: z.boolean().optional().describe('실제로 실행해서 사용 확인을 했으면 true'),
  openQuestions: z.array(z.string().min(1).max(1000)).max(20).optional().describe('미해결 질문'),
  nextTask: z.string().max(1000).optional().describe('다음 작업 제안'),
});
export type RecordWorkUpdateInput = z.infer<typeof recordWorkUpdateInput>;

const proposedNodeSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  isCore: z.boolean().optional(),
  parentFeatureId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe('부모 기능 ID (null이면 최상위)'),
});
export type ProposedNode = z.infer<typeof proposedNodeSchema>;

/**
 * MCP SDK의 inputSchema는 ZodRawShape(객체의 shape)를 받으므로,
 * superRefine이 붙지 않은 base 객체를 함께 노출한다.
 * 타입별 필수 조합 검증은 proposeStructureChangeInput.parse()로 핸들러에서 수행한다.
 */
export const proposeStructureChangeBase = z.object({
  projectId: z.string().min(1),
    type: z.enum(['CREATE', 'RETIRE', 'RENAME', 'MOVE', 'MERGE', 'SPLIT', 'REPLACE']),
    targetFeatureIds: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe('변경 대상 기존 기능 ID (CREATE 외에는 필수)'),
    title: z.string().max(200).optional().describe('제안 제목 (생략 시 자동 생성)'),
    reason: z.string().min(1).max(4000).describe('왜 이 구조 변경이 필요한지'),
    proposedNode: proposedNodeSchema
      .optional()
      .describe('CREATE/REPLACE/MERGE(새 노드로 병합)에서 만들 노드'),
    proposedNodes: z
      .array(proposedNodeSchema)
      .max(20)
      .optional()
      .describe('SPLIT에서 만들 노드 목록 (2개 이상)'),
    newName: z.string().min(1).max(120).optional().describe('RENAME의 새 이름'),
    newParentFeatureId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe('MOVE의 새 부모 (null이면 최상위)'),
    mergeIntoFeatureId: z
      .string()
      .min(1)
      .optional()
      .describe('MERGE에서 흡수할 기존 기능 ID (생략 시 proposedNode로 새 노드 생성)'),
    retireSource: z
      .boolean()
      .optional()
      .describe('SPLIT에서 원본 기능을 종료할지 (기본 true)'),
    evidence: z
      .object({
        files: z.array(z.string().min(1)).max(100).optional(),
        commits: z.array(z.string().min(1)).max(50).optional(),
        notes: z.string().max(2000).optional(),
      })
      .optional(),
});

export const proposeStructureChangeInput = proposeStructureChangeBase.superRefine((val, ctx) => {
    const targets = val.targetFeatureIds ?? [];
    const need = (cond: boolean, message: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    };
    switch (val.type) {
      case 'CREATE':
        need(!!val.proposedNode, 'CREATE에는 proposedNode가 필요합니다');
        break;
      case 'RETIRE':
        need(targets.length >= 1, 'RETIRE에는 targetFeatureIds가 1개 이상 필요합니다');
        break;
      case 'RENAME':
        need(targets.length === 1, 'RENAME에는 targetFeatureIds가 정확히 1개 필요합니다');
        need(!!val.newName, 'RENAME에는 newName이 필요합니다');
        break;
      case 'MOVE':
        need(targets.length === 1, 'MOVE에는 targetFeatureIds가 정확히 1개 필요합니다');
        need(val.newParentFeatureId !== undefined, 'MOVE에는 newParentFeatureId가 필요합니다');
        break;
      case 'MERGE':
        need(targets.length >= 2, 'MERGE에는 targetFeatureIds가 2개 이상 필요합니다');
        need(
          !!val.mergeIntoFeatureId || !!val.proposedNode,
          'MERGE에는 mergeIntoFeatureId 또는 proposedNode가 필요합니다',
        );
        break;
      case 'SPLIT':
        need(targets.length === 1, 'SPLIT에는 targetFeatureIds가 정확히 1개 필요합니다');
        need(
          (val.proposedNodes?.length ?? 0) >= 2,
          'SPLIT에는 proposedNodes가 2개 이상 필요합니다',
        );
        break;
      case 'REPLACE':
        need(targets.length === 1, 'REPLACE에는 targetFeatureIds가 정확히 1개 필요합니다');
        need(!!val.proposedNode, 'REPLACE에는 proposedNode가 필요합니다');
        break;
    }
});
export type ProposeStructureChangeInput = z.infer<typeof proposeStructureChangeInput>;

export const getNextTaskInput = z.object({
  projectId: z.string().min(1),
});
export type GetNextTaskInput = z.infer<typeof getNextTaskInput>;
