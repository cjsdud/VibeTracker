import {
  hashToken,
  type PrismaClient,
  type Project,
  type User,
} from '@vibetrack/tracker-core';

export const DEMO_USER_EMAIL = 'demo@vibetrack.local';
/** DEMO_MODE 전용 고정 토큰. 프로덕션에서는 seed되지 않는다. */
export const DEMO_MCP_TOKEN = 'vtk_demo_local_token_do_not_use_in_prod';

export const DEMO_SHAS = {
  auth: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  upload: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
  admin: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  analysis: 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
} as const;

interface DemoFeature {
  key: string;
  name: string;
  description?: string;
  isCore?: boolean;
  implementationStatus?: 'NOT_STARTED' | 'PARTIAL' | 'IMPLEMENTED' | 'CHANGED';
  verificationStatus?: 'UNKNOWN' | 'NEEDS_VERIFICATION' | 'PASSED' | 'FAILED' | 'MANUAL_VERIFIED';
  files?: string[];
  routes?: string[];
  apis?: string[];
  tests?: string[];
  children?: DemoFeature[];
  lastChangedDaysAgo?: number;
}

const demoTree: DemoFeature[] = [
  {
    key: 'access',
    name: '사용자 접근',
    isCore: true,
    implementationStatus: 'IMPLEMENTED',
    verificationStatus: 'PASSED',
    children: [
      {
        key: 'login',
        name: '로그인',
        description: '이메일/비밀번호 로그인과 세션 관리',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'PASSED',
        files: ['src/server/auth/login.ts', 'src/web/pages/Login.tsx'],
        routes: ['/login'],
        apis: ['POST /api/auth/login'],
        tests: ['src/server/auth/login.test.ts'],
        lastChangedDaysAgo: 6,
      },
      {
        key: 'roles',
        name: '권한 관리',
        description: '멤버/관리자 역할 구분',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'NEEDS_VERIFICATION',
        files: ['src/server/auth/roles.ts'],
        apis: ['GET /api/me/permissions'],
        tests: ['src/server/auth/roles.test.ts'],
        lastChangedDaysAgo: 2,
      },
      {
        key: 'admin',
        name: '관리자 접근',
        description: '관리자 전용 화면과 계정 관리',
        isCore: true,
        implementationStatus: 'PARTIAL',
        verificationStatus: 'NEEDS_VERIFICATION',
        files: ['src/web/pages/Admin.tsx', 'src/server/admin/'],
        routes: ['/admin'],
        lastChangedDaysAgo: 1,
      },
    ],
  },
  {
    key: 'upload',
    name: '데이터 업로드',
    isCore: true,
    implementationStatus: 'IMPLEMENTED',
    verificationStatus: 'PASSED',
    children: [
      {
        key: 'file-upload',
        name: '파일 업로드',
        description: 'CSV/XLSX 리뷰 파일 업로드',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'PASSED',
        files: ['src/server/upload/upload.ts', 'src/web/pages/Upload.tsx'],
        routes: ['/upload'],
        apis: ['POST /api/uploads'],
        tests: ['src/server/upload/upload.test.ts'],
        lastChangedDaysAgo: 8,
      },
      {
        key: 'column-mapping',
        name: '컬럼 매핑',
        description: '업로드 파일의 컬럼을 리뷰 필드에 매핑',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'MANUAL_VERIFIED',
        files: ['src/web/components/ColumnMapper.tsx'],
        lastChangedDaysAgo: 8,
      },
      {
        key: 'file-validation',
        name: '파일 검증',
        description: '인코딩/필수 컬럼/행 수 검증',
        implementationStatus: 'CHANGED',
        verificationStatus: 'NEEDS_VERIFICATION',
        files: ['src/server/upload/validate.ts'],
        tests: ['src/server/upload/validate.test.ts'],
        lastChangedDaysAgo: 0,
      },
    ],
  },
  {
    key: 'analysis',
    name: '분석',
    isCore: true,
    implementationStatus: 'PARTIAL',
    verificationStatus: 'UNKNOWN',
    children: [
      {
        key: 'sentiment',
        name: '감성 분류',
        description: '리뷰 긍정/부정/중립 분류',
        isCore: true,
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'PASSED',
        files: ['src/server/analysis/sentiment.ts'],
        apis: ['POST /api/analysis/sentiment'],
        tests: ['src/server/analysis/sentiment.test.ts'],
        lastChangedDaysAgo: 4,
      },
      {
        key: 'recurring-issues',
        name: '반복 이슈 추출',
        description: '자주 언급되는 불만/요청 클러스터링',
        implementationStatus: 'PARTIAL',
        verificationStatus: 'UNKNOWN',
        files: ['src/server/analysis/issues.ts'],
        lastChangedDaysAgo: 3,
      },
      {
        key: 'summary',
        name: '결과 요약',
        description: '기간별 분석 리포트 요약 화면',
        isCore: true,
        implementationStatus: 'NOT_STARTED',
        verificationStatus: 'UNKNOWN',
        routes: ['/reports'],
      },
    ],
  },
  {
    key: 'ops',
    name: '운영',
    implementationStatus: 'PARTIAL',
    verificationStatus: 'UNKNOWN',
    children: [
      {
        key: 'deploy',
        name: '배포',
        description: 'Render 배포 파이프라인',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'MANUAL_VERIFIED',
        files: ['render.yaml'],
        lastChangedDaysAgo: 10,
      },
      {
        key: 'error-handling',
        name: '오류 대응',
        description: '오류 알림과 재시도 정책',
        implementationStatus: 'NOT_STARTED',
        verificationStatus: 'UNKNOWN',
      },
    ],
  },
];

function daysAgo(days: number, hoursOffset = 0): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - hoursOffset * 60 * 60 * 1000);
}

/**
 * 데모 사용자/프로젝트/기능 트리/작업 기록/GitHub 이벤트를 seed한다.
 * 이미 있으면 그대로 반환한다 (idempotent).
 */
export async function ensureDemoData(
  prisma: PrismaClient,
): Promise<{ user: User; project: Project }> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (existing) {
    const project = await prisma.project.findFirstOrThrow({ where: { userId: existing.id } });
    return { user: existing, project };
  }

  const user = await prisma.user.create({
    data: { email: DEMO_USER_EMAIL, name: '데모 사용자', isDemo: true },
  });
  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: '리뷰 인사이트',
      goal: '쇼핑몰 고객 리뷰를 업로드하면 감성 분석과 반복 이슈를 요약해 주는 1인 SaaS',
    },
  });
  await prisma.repository.create({
    data: {
      projectId: project.id,
      owner: 'demo',
      name: 'review-insight',
      fullName: 'demo/review-insight',
      defaultBranch: 'main',
    },
  });
  await prisma.mcpToken.create({
    data: {
      projectId: project.id,
      name: 'demo',
      tokenHash: hashToken(DEMO_MCP_TOKEN),
      tokenPrefix: DEMO_MCP_TOKEN.slice(0, 10),
      lastUsedAt: daysAgo(0, 2),
    },
  });

  // 기능 트리 (승인 완료 상태의 ACTIVE 트리)
  const idByKey = new Map<string, string>();
  const createNodes = async (features: DemoFeature[], parentId: string | null): Promise<void> => {
    for (const [index, feature] of features.entries()) {
      const node = await prisma.featureNode.create({
        data: {
          projectId: project.id,
          parentId,
          name: feature.name,
          description: feature.description ?? null,
          isCore: feature.isCore ?? false,
          orderIndex: index,
          lifecycle: 'ACTIVE',
          implementationStatus: feature.implementationStatus ?? 'NOT_STARTED',
          verificationStatus: feature.verificationStatus ?? 'UNKNOWN',
          lastChangedAt:
            feature.lastChangedDaysAgo === undefined ? null : daysAgo(feature.lastChangedDaysAgo),
        },
      });
      idByKey.set(feature.key, node.id);
      const evidenceEntries = [
        ...(feature.files ?? []).map((p) => ({ type: 'FILE' as const, path: p })),
        ...(feature.routes ?? []).map((p) => ({ type: 'ROUTE' as const, path: p })),
        ...(feature.apis ?? []).map((p) => ({ type: 'API_ENDPOINT' as const, path: p })),
        ...(feature.tests ?? []).map((p) => ({ type: 'TEST' as const, path: p })),
      ];
      for (const entry of evidenceEntries) {
        await prisma.featureEvidence.create({
          data: {
            projectId: project.id,
            featureNodeId: node.id,
            type: entry.type,
            path: entry.path,
          },
        });
      }
      await createNodes(feature.children ?? [], node.id);
    }
  };
  await createNodes(demoTree, null);

  // 승인된 트리 버전 1
  const nodes = await prisma.featureNode.findMany({ where: { projectId: project.id } });
  await prisma.featureTreeVersion.create({
    data: {
      projectId: project.id,
      version: 1,
      cause: 'BOOTSTRAP_APPROVED',
      createdByUserId: user.id,
      snapshot: nodes.map((n) => ({
        id: n.id,
        parentId: n.parentId,
        name: n.name,
        isCore: n.isCore,
        orderIndex: n.orderIndex,
        lifecycle: n.lifecycle,
        implementationStatus: n.implementationStatus,
        verificationStatus: n.verificationStatus,
      })),
    },
  });
  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      userId: user.id,
      action: 'feature_map.approved',
      detail: { approvedCount: nodes.length, version: 1 },
      createdAt: daysAgo(9),
    },
  });

  const featureId = (key: string): string => {
    const id = idByKey.get(key);
    if (!id) throw new Error(`demo feature not found: ${key}`);
    return id;
  };

  // 작업 기록
  const workUpdates: {
    key: string;
    features: string[];
    summary: string;
    files: string[];
    sha: string | null;
    tests: 'PASSED' | 'FAILED' | 'NOT_RUN' | null;
    manualCheck?: boolean;
    nextTask?: string;
    questions?: string[];
    createdDaysAgo: number;
  }[] = [
    {
      key: 'wu-login',
      features: ['login'],
      summary: '로그인 실패 시 잠금 정책 추가 및 세션 만료 버그 수정',
      files: ['src/server/auth/login.ts', 'src/server/auth/login.test.ts'],
      sha: DEMO_SHAS.auth,
      tests: 'PASSED',
      createdDaysAgo: 6,
    },
    {
      key: 'wu-upload',
      features: ['file-upload', 'column-mapping'],
      summary: 'XLSX 업로드 지원 추가, 컬럼 자동 매핑 휴리스틱 구현',
      files: ['src/server/upload/upload.ts', 'src/web/components/ColumnMapper.tsx'],
      sha: DEMO_SHAS.upload,
      tests: 'PASSED',
      manualCheck: true,
      createdDaysAgo: 5,
    },
    {
      key: 'wu-roles',
      features: ['roles'],
      summary: '역할 기반 권한 미들웨어 구현. 관리자/멤버 구분 적용',
      files: ['src/server/auth/roles.ts'],
      sha: DEMO_SHAS.admin,
      tests: 'NOT_RUN',
      questions: ['초대받은 사용자의 기본 역할을 멤버로 할지 뷰어로 할지 결정 필요'],
      nextTask: '실제 관리자 계정으로 권한 화면 접근 테스트',
      createdDaysAgo: 2,
    },
    {
      key: 'wu-validate',
      features: ['file-validation'],
      summary: '파일 검증에 인코딩 감지 추가 (EUC-KR 대응)',
      files: ['src/server/upload/validate.ts'],
      sha: null,
      tests: 'NOT_RUN',
      questions: ['10MB 이상 파일 스트리밍 검증 방식 결정 필요'],
      createdDaysAgo: 0,
    },
  ];
  const workUpdateIds = new Map<string, string>();
  for (const wu of workUpdates) {
    const created = await prisma.workUpdate.create({
      data: {
        projectId: project.id,
        source: 'MCP',
        summary: wu.summary,
        changedFiles: wu.files,
        gitHeadSha: wu.sha,
        testsStatus: wu.tests,
        testsPassed: wu.tests === 'PASSED' ? 12 : null,
        testsFailed: 0,
        manualCheck: wu.manualCheck ?? false,
        nextTask: wu.nextTask ?? null,
        createdAt: daysAgo(wu.createdDaysAgo, 1),
        features: { create: wu.features.map((k) => ({ featureNodeId: featureId(k) })) },
      },
    });
    workUpdateIds.set(wu.key, created.id);
    for (const question of wu.questions ?? []) {
      await prisma.openQuestion.create({
        data: {
          projectId: project.id,
          featureNodeId: featureId(wu.features[0] ?? 'login'),
          workUpdateId: created.id,
          question,
          createdAt: daysAgo(wu.createdDaysAgo),
        },
      });
    }
    if (wu.tests === 'PASSED') {
      for (const key of wu.features) {
        await prisma.verificationRun.create({
          data: {
            projectId: project.id,
            featureNodeId: featureId(key),
            workUpdateId: created.id,
            commitSha: wu.sha,
            source: 'MCP',
            status: 'PASSED',
            name: 'Claude Code 테스트 실행',
            createdAt: daysAgo(wu.createdDaysAgo, 0.5),
          },
        });
      }
    }
    // 커밋/파일 증거 연결
    for (const key of wu.features) {
      if (wu.sha) {
        await prisma.featureEvidence.create({
          data: {
            projectId: project.id,
            featureNodeId: featureId(key),
            type: 'COMMIT',
            ref: wu.sha,
            title: wu.summary.slice(0, 80),
            workUpdateId: created.id,
          },
        });
      }
    }
  }

  // GitHub 이벤트 (처리 완료 상태의 활동 기록)
  const githubEvents = [
    {
      deliveryId: 'demo-push-auth',
      eventType: 'push',
      payload: {
        ref: 'refs/heads/main',
        after: DEMO_SHAS.auth,
        repository: { full_name: 'demo/review-insight' },
        commits: [
          {
            id: DEMO_SHAS.auth,
            message: 'fix: 로그인 세션 만료 버그 수정',
            added: [],
            modified: ['src/server/auth/login.ts', 'src/server/auth/login.test.ts'],
            removed: [],
          },
        ],
      },
      receivedDaysAgo: 6,
    },
    {
      deliveryId: 'demo-check-auth',
      eventType: 'check_run',
      payload: {
        action: 'completed',
        check_run: { name: 'CI / test', head_sha: DEMO_SHAS.auth, conclusion: 'success' },
        repository: { full_name: 'demo/review-insight' },
      },
      receivedDaysAgo: 6,
    },
    {
      deliveryId: 'demo-push-scripts',
      eventType: 'push',
      payload: {
        ref: 'refs/heads/main',
        after: DEMO_SHAS.analysis,
        repository: { full_name: 'demo/review-insight' },
        commits: [
          {
            id: DEMO_SHAS.analysis,
            message: 'chore: 분석 결과 캐시 스크립트 추가',
            added: ['scripts/cache-warm.ts', 'src/server/analysis/cache.ts'],
            modified: [],
            removed: [],
          },
        ],
      },
      receivedDaysAgo: 1,
    },
  ];
  const eventIds = new Map<string, string>();
  for (const event of githubEvents) {
    const created = await prisma.githubEvent.create({
      data: {
        projectId: project.id,
        deliveryId: event.deliveryId,
        eventType: event.eventType,
        action: (event.payload as { action?: string }).action ?? null,
        payload: event.payload,
        status: 'PROCESSED',
        receivedAt: daysAgo(event.receivedDaysAgo, 0.8),
        processedAt: daysAgo(event.receivedDaysAgo, 0.7),
      },
    });
    eventIds.set(event.deliveryId, created.id);
  }

  // 승인 대기 구조 변경 제안 1개
  const proposal = await prisma.changeProposal.create({
    data: {
      projectId: project.id,
      type: 'CREATE',
      title: '새 기능 제안: 리포트 이메일 발송',
      reason:
        '사용자가 매주 분석 요약을 이메일로 받고 싶어한다. 결과 요약 기능과 별도의 발송 파이프라인이 필요하다.',
      targetFeatureIds: [],
      payload: {
        proposedNode: {
          name: '리포트 이메일 발송',
          description: '주간 분석 요약을 이메일로 발송',
          isCore: false,
          parentFeatureId: featureId('analysis'),
        },
      },
      source: 'MCP',
      createdAt: daysAgo(1, 2),
    },
  });
  await prisma.inboxItem.create({
    data: {
      projectId: project.id,
      type: 'STRUCTURE_PROPOSAL',
      title: proposal.title,
      changeProposalId: proposal.id,
      detail: { proposalType: 'CREATE' },
      createdAt: daysAgo(1, 2),
    },
  });

  // 추적되지 않은 변경 2개
  await prisma.inboxItem.create({
    data: {
      projectId: project.id,
      type: 'UNTRACKED_CHANGE',
      title: '추적되지 않은 변경 2개 파일 (main)',
      githubEventId: eventIds.get('demo-push-scripts'),
      detail: {
        changedFiles: ['scripts/cache-warm.ts', 'src/server/analysis/cache.ts'],
        commitShas: [DEMO_SHAS.analysis],
        branch: 'main',
      },
      createdAt: daysAgo(1, 0.5),
    },
  });
  await prisma.inboxItem.create({
    data: {
      projectId: project.id,
      type: 'UNTRACKED_CHANGE',
      title: '추적되지 않은 작업: 랜딩 페이지 문구 수정',
      workUpdateId: workUpdateIds.get('wu-validate'),
      detail: { changedFiles: ['src/web/pages/Landing.tsx'], gitHeadSha: null },
      createdAt: daysAgo(0, 6),
    },
  });

  return { user, project };
}
