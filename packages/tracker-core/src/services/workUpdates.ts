import { type RecordWorkUpdateInput, type WorkUpdateSource } from '@vibetrack/shared';
import { type FeatureNode, type PrismaClient, type WorkUpdate } from '../db.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { writeAudit } from './audit.js';
import { upsertBranchActivity } from './branchActivity.js';
import { upsertEvidence } from './evidence.js';

export interface RecordWorkUpdateResult {
  workUpdate: WorkUpdate;
  linkedFeatures: { id: string; name: string }[];
  untracked: boolean;
  verificationApplied: string | null;
  /** occurredAt으로 소급 기록된 경우 true (상태 변경 없음) */
  historical: boolean;
  /** 기본 브랜치가 아닌 브랜치 작업이라 "작업 중 변경"으로만 기록된 경우 true */
  branchOnly: boolean;
}

/**
 * record_work_update: Claude Code 작업 결과를 기록한다.
 * - 기존 기능의 타임라인/증거/상태는 자동 갱신한다 (구조 변경은 하지 않는다).
 * - 코드가 바뀌면 검증 상태를 NEEDS_VERIFICATION으로, 테스트 결과가 있으면 PASSED/FAILED로,
 *   실제 사용 확인이면 MANUAL_VERIFIED로 갱신한다.
 * - featureIds가 없거나 매칭되지 않으면 UNTRACKED_CHANGE로 Inbox에 넣는다.
 */
export async function recordWorkUpdate(
  prisma: PrismaClient,
  params: { input: RecordWorkUpdateInput; source?: WorkUpdateSource },
): Promise<RecordWorkUpdateResult> {
  const { input } = params;

  return prisma.$transaction(async (tx) => {
    // 기능 매칭: 프로젝트에 속하지 않는 ID는 거부하지 않고 unmatched로 취급한다.
    const requested = [...new Set(input.featureIds ?? [])];
    const features: FeatureNode[] = requested.length
      ? await tx.featureNode.findMany({
          where: {
            id: { in: requested },
            projectId: input.projectId,
            lifecycle: { not: 'RETIRED' },
          },
        })
      : [];
    const unmatchedIds = requested.filter((id) => !features.some((f) => f.id === id));
    if (requested.length > 0 && features.length === 0) {
      throw new NotFoundError(
        '지정한 기능을 찾을 수 없습니다. get_project_context로 기능 ID를 다시 확인하세요.',
      );
    }

    const changedFiles = input.changedFiles ?? [];
    const testsStatus = input.tests?.status ?? null;

    // 과거 세션 소급 기록(occurredAt): 타임라인/증거/질문만 남기고
    // 현재 기능 상태(구현/검증)는 변경하지 않는다. 그 사이 상황이 이미 달라졌을 수 있다.
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
    if (occurredAt !== null && occurredAt.getTime() > Date.now() + 60_000) {
      throw new ValidationError(
        'occurredAt이 미래 시각입니다. 과거 세션 소급 기록에만 사용하세요 (타임존 확인: UTC ISO 8601).',
      );
    }
    const isHistorical = occurredAt !== null && occurredAt.getTime() < Date.now() - 60_000;

    // 브랜치 상태 분리: 기본 브랜치가 아닌 브랜치의 작업은 공식 상태(FeatureNode)를
    // 바꾸지 않고 "작업 중 변경"(FeatureBranchActivity)으로만 기록한다.
    // 공식 상태는 PR이 기본 브랜치에 머지될 때 GitHub 이벤트가 승격한다.
    const repository = await tx.repository.findUnique({
      where: { projectId: input.projectId },
      select: { defaultBranch: true },
    });
    const defaultBranch = repository?.defaultBranch ?? 'main';
    const isBranchOnly = Boolean(input.branch) && input.branch !== defaultBranch && !isHistorical;

    const workUpdate = await tx.workUpdate.create({
      data: {
        projectId: input.projectId,
        source: params.source ?? 'MCP',
        summary: input.summary,
        changedFiles,
        gitHeadSha: input.gitHeadSha ?? null,
        commitShas: input.commitShas ?? [],
        branch: input.branch ?? null,
        testsStatus,
        testsPassed: input.tests?.passed ?? null,
        testsFailed: input.tests?.failed ?? null,
        testsSummary: input.tests?.summary ?? null,
        manualCheck: input.manualCheck ?? false,
        nextTask: input.nextTask ?? null,
        ...(occurredAt ? { createdAt: occurredAt } : {}),
        features: { create: features.map((f) => ({ featureNodeId: f.id })) },
      },
    });

    // 검증 상태 결정: 실패 > 수동 확인 > 통과 > (코드 변경 시) 검증 필요
    let verification: 'FAILED' | 'MANUAL_VERIFIED' | 'PASSED' | 'NEEDS_VERIFICATION' | null = null;
    if (testsStatus === 'FAILED') verification = 'FAILED';
    else if (input.manualCheck) verification = 'MANUAL_VERIFIED';
    else if (testsStatus === 'PASSED') verification = 'PASSED';
    else if (changedFiles.length > 0) verification = 'NEEDS_VERIFICATION';
    if (isHistorical || isBranchOnly) verification = null;

    const now = new Date();
    // 코드 변경이 없는 기록(리뷰만, 검증만)은 구현 상태를 건드리지 않는다
    const hasCodeChange = changedFiles.length > 0;
    for (const feature of features) {
      // 브랜치 작업: 공식 상태 대신 "작업 중 변경"으로 기록
      if (isBranchOnly) {
        await upsertBranchActivity(tx, {
          projectId: input.projectId,
          featureNodeId: feature.id,
          branch: input.branch!,
          source: 'MCP_RECORD',
          summary: input.summary.slice(0, 300),
          lastCommitSha: input.gitHeadSha ?? input.commitShas?.at(-1) ?? null,
          ...(testsStatus === 'FAILED'
            ? { ciFailed: true }
            : testsStatus === 'PASSED'
              ? { ciFailed: false }
              : {}),
        });
      }
      const implementation =
        isHistorical || isBranchOnly
          ? null
          : (input.implementationStatus ??
            (hasCodeChange
              ? feature.implementationStatus === 'NOT_STARTED'
                ? 'PARTIAL'
                : 'CHANGED'
              : null));
      // 소급 기록은 lastChangedAt을 뒤로 돌리지 않되, 비어 있거나 더 오래됐으면 채워준다
      const lastChangedAt = isHistorical
        ? !feature.lastChangedAt || feature.lastChangedAt < occurredAt
          ? occurredAt
          : null
        : !isBranchOnly && (hasCodeChange || implementation)
          ? now
          : null;
      await tx.featureNode.update({
        where: { id: feature.id },
        data: {
          ...(implementation ? { implementationStatus: implementation } : {}),
          ...(verification ? { verificationStatus: verification } : {}),
          // 공식 상태(구현/검증)가 바뀔 때만 출처를 기록한다
          ...(implementation || verification ? { lastStatusSource: 'MCP_RECORD' as const } : {}),
          ...(lastChangedAt ? { lastChangedAt } : {}),
        },
      });

      await upsertEvidence(tx, {
        projectId: input.projectId,
        featureNodeId: feature.id,
        type: 'WORK_UPDATE',
        ref: workUpdate.id,
        title: input.summary.slice(0, 140),
        workUpdateId: workUpdate.id,
      });
      if (input.gitHeadSha) {
        await upsertEvidence(tx, {
          projectId: input.projectId,
          featureNodeId: feature.id,
          type: 'COMMIT',
          ref: input.gitHeadSha,
          workUpdateId: workUpdate.id,
        });
      }
      for (const file of changedFiles) {
        await upsertEvidence(tx, {
          projectId: input.projectId,
          featureNodeId: feature.id,
          type: 'FILE',
          path: file,
          workUpdateId: workUpdate.id,
        });
      }

      if (testsStatus === 'PASSED' || testsStatus === 'FAILED') {
        await tx.verificationRun.create({
          data: {
            projectId: input.projectId,
            featureNodeId: feature.id,
            workUpdateId: workUpdate.id,
            commitSha: input.gitHeadSha ?? null,
            source: 'MCP',
            status: testsStatus,
            name: 'Claude Code 테스트 실행',
            ...(occurredAt ? { createdAt: occurredAt } : {}),
            details: {
              passed: input.tests?.passed ?? null,
              failed: input.tests?.failed ?? null,
              summary: input.tests?.summary ?? null,
            },
          },
        });
      }
      // 과거의 테스트 실패는 이미 해결됐을 수 있으므로 Inbox 알림을 만들지 않는다.
      // 브랜치 작업의 실패는 공식 문제가 아니라 브랜치 활동의 CI 실패 플래그로만 남는다.
      if (testsStatus === 'FAILED' && !isHistorical && !isBranchOnly) {
        await tx.inboxItem.create({
          data: {
            projectId: input.projectId,
            type: 'TEST_FAILURE',
            title: `테스트 실패: ${feature.name}`,
            featureNodeId: feature.id,
            workUpdateId: workUpdate.id,
            detail: { summary: input.tests?.summary ?? null, failed: input.tests?.failed ?? null },
          },
        });
      }
    }

    for (const question of input.openQuestions ?? []) {
      await tx.openQuestion.create({
        data: {
          projectId: input.projectId,
          question,
          featureNodeId: features[0]?.id ?? null,
          workUpdateId: workUpdate.id,
        },
      });
    }

    // 기능 매칭이 전혀 없는 작업 → 추적되지 않은 변경으로 Inbox에
    const untracked = features.length === 0;
    if (untracked) {
      await tx.inboxItem.create({
        data: {
          projectId: input.projectId,
          type: 'UNTRACKED_CHANGE',
          title: `추적되지 않은 작업: ${input.summary.slice(0, 80)}`,
          workUpdateId: workUpdate.id,
          detail: {
            changedFiles,
            gitHeadSha: input.gitHeadSha ?? null,
            requestedFeatureIds: requested,
          },
        },
      });
    }

    await writeAudit(tx, {
      projectId: input.projectId,
      action: 'work_update.recorded',
      entityType: 'WorkUpdate',
      entityId: workUpdate.id,
      detail: {
        featureCount: features.length,
        unmatchedIds,
        testsStatus,
        untracked,
        historical: isHistorical,
        branchOnly: isBranchOnly,
        branch: input.branch ?? null,
        source: 'MCP_RECORD',
      },
    });

    return {
      workUpdate,
      linkedFeatures: features.map((f) => ({ id: f.id, name: f.name })),
      untracked,
      verificationApplied: verification,
      historical: isHistorical,
      branchOnly: isBranchOnly,
    };
  });
}
