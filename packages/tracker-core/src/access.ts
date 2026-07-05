import { type Db, type Project } from './db.js';
import { NotFoundError } from './errors.js';

/**
 * 모든 프로젝트 데이터 접근의 관문.
 * 다른 사용자의 프로젝트는 존재 여부를 노출하지 않기 위해 404로 처리한다.
 */
export async function requireProjectAccess(
  db: Db,
  projectId: string,
  userId: string,
): Promise<Project> {
  const project = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    throw new NotFoundError('프로젝트를 찾을 수 없습니다.');
  }
  return project;
}

/** MCP 토큰 경로: 토큰이 이미 프로젝트 범위이므로 projectId 일치만 확인한다. */
export async function requireProject(db: Db, projectId: string): Promise<Project> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new NotFoundError('프로젝트를 찾을 수 없습니다.');
  }
  return project;
}
