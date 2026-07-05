import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Db, type McpToken, type Project } from '../db.js';
import { NotFoundError, UnauthorizedError } from '../errors.js';
import { writeAudit } from './audit.js';

const TOKEN_PREFIX = 'vtk_';

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * 프로젝트 범위 MCP 연결 토큰 발급.
 * 평문은 응답으로 한 번만 반환하고 DB에는 SHA-256 해시만 저장한다.
 */
export async function createMcpToken(
  db: Db,
  params: { projectId: string; userId: string; name?: string },
): Promise<{ token: McpToken; plaintext: string }> {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const token = await db.mcpToken.create({
    data: {
      projectId: params.projectId,
      name: params.name ?? 'default',
      tokenHash: hashToken(plaintext),
      tokenPrefix: plaintext.slice(0, TOKEN_PREFIX.length + 6),
    },
  });
  await writeAudit(db, {
    projectId: params.projectId,
    userId: params.userId,
    action: 'mcp_token.created',
    entityType: 'McpToken',
    entityId: token.id,
  });
  return { token, plaintext };
}

export async function revokeMcpToken(
  db: Db,
  params: { projectId: string; userId: string; tokenId: string },
): Promise<McpToken> {
  const existing = await db.mcpToken.findFirst({
    where: { id: params.tokenId, projectId: params.projectId },
  });
  if (!existing) throw new NotFoundError('토큰을 찾을 수 없습니다.');
  const token = await db.mcpToken.update({
    where: { id: existing.id },
    data: { revokedAt: existing.revokedAt ?? new Date() },
  });
  await writeAudit(db, {
    projectId: params.projectId,
    userId: params.userId,
    action: 'mcp_token.revoked',
    entityType: 'McpToken',
    entityId: token.id,
  });
  return token;
}

export async function listMcpTokens(db: Db, projectId: string): Promise<McpToken[]> {
  return db.mcpToken.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
}

/**
 * Bearer 토큰 검증. 성공 시 토큰이 속한 프로젝트를 반환한다.
 * 이후 OAuth 등으로 교체할 수 있도록 이 함수만이 MCP 인증의 진입점이다.
 */
export async function authenticateMcpToken(
  db: Db,
  bearer: string | undefined,
): Promise<{ project: Project; token: McpToken }> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX)) {
    throw new UnauthorizedError('유효한 VibeTrack 연결 토큰이 필요합니다.');
  }
  const tokenHash = hashToken(bearer);
  const token = await db.mcpToken.findUnique({
    where: { tokenHash },
    include: { project: true },
  });
  // findUnique가 해시 비교를 수행하지만, 방어적으로 상수 시간 비교를 한 번 더 한다.
  if (
    !token ||
    !timingSafeEqual(Buffer.from(token.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'))
  ) {
    throw new UnauthorizedError('유효하지 않은 연결 토큰입니다.');
  }
  if (token.revokedAt) {
    throw new UnauthorizedError('폐기된 연결 토큰입니다. 설정에서 재발급하세요.');
  }
  const updated = await db.mcpToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });
  return { project: token.project, token: updated };
}
