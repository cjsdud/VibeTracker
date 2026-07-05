import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateMcpToken,
  createMcpToken,
  hashToken,
  requireProjectAccess,
  revokeMcpToken,
} from '../src/index.js';
import { createTestDb, createUserAndProject, resetDb } from './helpers.js';

const prisma = createTestDb();

describe('MCP token authorization', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('토큰은 평문이 아니라 해시로 저장된다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const { token, plaintext } = await createMcpToken(prisma, { projectId, userId });
    expect(plaintext.startsWith('vtk_')).toBe(true);
    expect(token.tokenHash).toBe(hashToken(plaintext));
    expect(token.tokenHash).not.toContain(plaintext.slice(4));
    // DB 어디에도 평문이 없다
    const stored = await prisma.mcpToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.tokenPrefix.length).toBeLessThan(12);
  });

  it('유효한 토큰은 프로젝트를 반환하고 lastUsedAt을 갱신한다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const { plaintext } = await createMcpToken(prisma, { projectId, userId });
    const { project, token } = await authenticateMcpToken(prisma, plaintext);
    expect(project.id).toBe(projectId);
    expect(token.lastUsedAt).not.toBeNull();
  });

  it('잘못된/폐기된 토큰은 거부된다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const { token, plaintext } = await createMcpToken(prisma, { projectId, userId });

    await expect(authenticateMcpToken(prisma, undefined)).rejects.toThrow(/토큰/);
    await expect(authenticateMcpToken(prisma, 'vtk_wrong_token')).rejects.toThrow(/유효하지/);
    await expect(authenticateMcpToken(prisma, 'not-a-token')).rejects.toThrow();

    await revokeMcpToken(prisma, { projectId, userId, tokenId: token.id });
    await expect(authenticateMcpToken(prisma, plaintext)).rejects.toThrow(/폐기/);
  });

  it('다른 프로젝트의 토큰은 폐기할 수 없다', async () => {
    const p1 = await createUserAndProject(prisma, '1');
    const p2 = await createUserAndProject(prisma, '2');
    const { token } = await createMcpToken(prisma, {
      projectId: p1.projectId,
      userId: p1.userId,
    });
    await expect(
      revokeMcpToken(prisma, { projectId: p2.projectId, userId: p2.userId, tokenId: token.id }),
    ).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe('project isolation', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('다른 사용자의 프로젝트 접근은 404로 처리된다', async () => {
    const p1 = await createUserAndProject(prisma, '1');
    const p2 = await createUserAndProject(prisma, '2');

    await expect(requireProjectAccess(prisma, p1.projectId, p1.userId)).resolves.toBeTruthy();
    await expect(requireProjectAccess(prisma, p1.projectId, p2.userId)).rejects.toMatchObject({
      httpStatus: 404,
    });
    await expect(requireProjectAccess(prisma, 'nonexistent', p1.userId)).rejects.toMatchObject({
      httpStatus: 404,
    });
  });
});
