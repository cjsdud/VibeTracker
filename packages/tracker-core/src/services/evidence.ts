import { type EvidenceType } from '@vibetrack/shared';
import { type Db, type FeatureEvidence, type Prisma } from '../db.js';

/**
 * 같은 (기능, 타입, path, ref) 증거를 중복 생성하지 않는다.
 * 이미 있으면 missing 플래그를 해제하고 최신화한다.
 */
export async function upsertEvidence(
  db: Db,
  params: {
    projectId: string;
    featureNodeId: string;
    type: EvidenceType;
    path?: string | null;
    ref?: string | null;
    title?: string | null;
    url?: string | null;
    workUpdateId?: string | null;
    githubEventId?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<FeatureEvidence> {
  const existing = await db.featureEvidence.findFirst({
    where: {
      projectId: params.projectId,
      featureNodeId: params.featureNodeId,
      type: params.type,
      path: params.path ?? null,
      ref: params.ref ?? null,
    },
  });
  if (existing) {
    return db.featureEvidence.update({
      where: { id: existing.id },
      data: {
        missing: false,
        title: params.title ?? existing.title,
        url: params.url ?? existing.url,
        workUpdateId: params.workUpdateId ?? existing.workUpdateId,
        githubEventId: params.githubEventId ?? existing.githubEventId,
      },
    });
  }
  return db.featureEvidence.create({
    data: {
      projectId: params.projectId,
      featureNodeId: params.featureNodeId,
      type: params.type,
      path: params.path ?? null,
      ref: params.ref ?? null,
      title: params.title ?? null,
      url: params.url ?? null,
      workUpdateId: params.workUpdateId ?? null,
      githubEventId: params.githubEventId ?? null,
      metadata: params.metadata,
    },
  });
}

/** 변경 파일 경로가 이 프로젝트의 어떤 기능 증거와 매칭되는지 찾는다. */
export async function findFeaturesForFiles(
  db: Db,
  projectId: string,
  filePaths: string[],
): Promise<{ matched: Map<string, string[]>; unmatchedFiles: string[] }> {
  if (filePaths.length === 0) return { matched: new Map(), unmatchedFiles: [] };
  const fileEvidence = await db.featureEvidence.findMany({
    where: {
      projectId,
      type: { in: ['FILE', 'TEST', 'DOCUMENT'] },
      path: { not: null },
      featureNode: { lifecycle: { not: 'RETIRED' } },
    },
    select: { featureNodeId: true, path: true },
  });

  const matched = new Map<string, string[]>(); // featureNodeId -> matched files
  const unmatchedFiles: string[] = [];
  for (const file of filePaths) {
    let hit = false;
    for (const ev of fileEvidence) {
      if (!ev.path) continue;
      // 정확히 일치하거나, 증거 경로가 디렉터리로서 파일을 포함하는 경우
      if (ev.path === file || file.startsWith(ev.path.replace(/\/$/, '') + '/')) {
        const list = matched.get(ev.featureNodeId) ?? [];
        if (!list.includes(file)) list.push(file);
        matched.set(ev.featureNodeId, list);
        hit = true;
      }
    }
    if (!hit) unmatchedFiles.push(file);
  }
  return { matched, unmatchedFiles };
}
