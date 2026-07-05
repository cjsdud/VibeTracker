import { type RecordWorkUpdateInput, type WorkUpdateSource } from '@vibetrack/shared';
import { type FeatureNode, type PrismaClient, type WorkUpdate } from '../db.js';
import { NotFoundError } from '../errors.js';
import { writeAudit } from './audit.js';
import { upsertEvidence } from './evidence.js';

export interface RecordWorkUpdateResult {
  workUpdate: WorkUpdate;
  linkedFeatures: { id: string; name: string }[];
  untracked: boolean;
  verificationApplied: string | null;
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
          where: { id: { in: requested }, projectId: input.projectId, lifecycle: { not: 'RETIRED' } },
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

    const workUpdate = await tx.workUpdate.create({
      data: {
        projectId: input.projectId,
        source: params.source ?? 'MCP',
        summary: input.summary,
        changedFiles,
        gitHeadSha: input.gitHeadSha ?? null,
        testsStatus,
        testsPassed: input.tests?.passed ?? null,
        testsFailed: input.tests?.failed ?? null,
        testsSummary: input.tests?.summary ?? null,
        manualCheck: input.manualCheck ?? false,
        nextTask: input.nextTask ?? null,
        features: { create: features.map((f) => ({ featureNodeId: f.id })) },
      },
    });

    // 검증 상태 결정: 실패 > 수동 확인 > 통과 > (코드 변경 시) 검증 필요
    let verification: 'FAILED' | 'MANUAL_VERIFIED' | 'PASSED' | 'NEEDS_VERIFICATION' | null = null;
    if (testsStatus === 'FAILED') verification = 'FAILED';
    else if (input.manualCheck) verification = 'MANUAL_VERIFIED';
    else if (testsStatus === 'PASSED') verification = 'PASSED';
    else if (changedFiles.length > 0) verification = 'NEEDS_VERIFICATION';

    const now = new Date();
    for (const feature of features) {
      const implementation =
        input.implementationStatus ??
        (feature.implementationStatus === 'NOT_STARTED' ? 'PARTIAL' : 'CHANGED');
      await tx.featureNode.update({
        where: { id: feature.id },
        data: {
          implementationStatus: implementation,
          ...(verification ? { verificationStatus: verification } : {}),
          lastChangedAt: now,
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
            details: {
              passed: input.tests?.passed ?? null,
              failed: input.tests?.failed ?? null,
              summary: input.tests?.summary ?? null,
            },
          },
        });
      }
      if (testsStatus === 'FAILED') {
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
      },
    });

    return {
      workUpdate,
      linkedFeatures: features.map((f) => ({ id: f.id, name: f.name })),
      untracked,
      verificationApplied: verification,
    };
  });
}
