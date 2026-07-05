import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { approveProposal, createProposal, editProposal, rejectProposal } from '../src/index.js';
import { createTestDb, createUserAndProject, resetDb } from './helpers.js';

const prisma = createTestDb();

async function activeFeature(projectId: string, name: string, parentId: string | null = null) {
  return prisma.featureNode.create({
    data: { projectId, name, parentId, lifecycle: 'ACTIVE' },
  });
}

describe('structure proposals', () => {
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('제안 생성은 트리를 건드리지 않고 PENDING + Inbox만 만든다', async () => {
    const { projectId } = await createUserAndProject(prisma);
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'CREATE',
        reason: '알림이 필요함',
        proposedNode: { name: '알림', parentFeatureId: null },
      },
    });
    expect(proposal.status).toBe('PENDING');
    expect(await prisma.featureNode.count({ where: { projectId } })).toBe(0);
    expect(
      await prisma.inboxItem.count({
        where: { projectId, type: 'STRUCTURE_PROPOSAL', status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('CREATE 승인 시에만 노드가 생기고 트리 버전이 증가한다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'CREATE',
        reason: '알림 기능',
        proposedNode: { name: '알림', isCore: true, parentFeatureId: null },
      },
    });
    const { version } = await approveProposal(prisma, {
      projectId,
      userId,
      proposalId: proposal.id,
    });
    expect(version).toBe(1);
    const node = await prisma.featureNode.findFirstOrThrow({ where: { projectId, name: '알림' } });
    expect(node.lifecycle).toBe('ACTIVE');
    const updated = await prisma.changeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(updated.status).toBe('APPROVED');
    // Inbox 항목도 함께 정리된다
    expect(
      await prisma.inboxItem.count({ where: { changeProposalId: proposal.id, status: 'OPEN' } }),
    ).toBe(0);
  });

  it('RETIRE 승인은 삭제가 아니라 RETIRED 처리다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const feature = await activeFeature(projectId, '구버전 검색');
    const proposal = await createProposal(prisma, {
      input: { projectId, type: 'RETIRE', reason: '대체됨', targetFeatureIds: [feature.id] },
    });
    await approveProposal(prisma, { projectId, userId, proposalId: proposal.id });
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.lifecycle).toBe('RETIRED');
    expect(after.retiredAt).not.toBeNull();
  });

  it('REJECT는 트리를 바꾸지 않는다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const feature = await activeFeature(projectId, '검색');
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'RENAME',
        reason: '이름 정리',
        targetFeatureIds: [feature.id],
        newName: '통합 검색',
      },
    });
    await rejectProposal(prisma, { projectId, userId, proposalId: proposal.id });
    const after = await prisma.featureNode.findUniqueOrThrow({ where: { id: feature.id } });
    expect(after.name).toBe('검색');
    const updated = await prisma.changeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(updated.status).toBe('REJECTED');
    // 이미 처리된 제안은 다시 승인할 수 없다
    await expect(
      approveProposal(prisma, { projectId, userId, proposalId: proposal.id }),
    ).rejects.toThrow(/이미 처리된/);
  });

  it('MERGE는 증거/자식을 이관하고 원본을 종료하며 계보를 남긴다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const a = await activeFeature(projectId, '이메일 알림');
    const b = await activeFeature(projectId, '푸시 알림');
    const child = await activeFeature(projectId, '알림 설정', a.id);
    await prisma.featureEvidence.create({
      data: { projectId, featureNodeId: a.id, type: 'FILE', path: 'src/notify/email.ts' },
    });
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'MERGE',
        reason: '알림 채널 통합',
        targetFeatureIds: [a.id, b.id],
        proposedNode: { name: '알림', parentFeatureId: null },
      },
    });
    await approveProposal(prisma, { projectId, userId, proposalId: proposal.id });

    const merged = await prisma.featureNode.findFirstOrThrow({
      where: { projectId, name: '알림' },
    });
    expect(merged.lifecycle).toBe('ACTIVE');
    const aAfter = await prisma.featureNode.findUniqueOrThrow({ where: { id: a.id } });
    const bAfter = await prisma.featureNode.findUniqueOrThrow({ where: { id: b.id } });
    expect(aAfter.lifecycle).toBe('RETIRED');
    expect(bAfter.lifecycle).toBe('RETIRED');
    const childAfter = await prisma.featureNode.findUniqueOrThrow({ where: { id: child.id } });
    expect(childAfter.parentId).toBe(merged.id);
    const evidence = await prisma.featureEvidence.findFirstOrThrow({
      where: { projectId, path: 'src/notify/email.ts' },
    });
    expect(evidence.featureNodeId).toBe(merged.id);
    const relations = await prisma.featureRelation.findMany({
      where: { projectId, type: 'MERGED_INTO' },
    });
    expect(relations).toHaveLength(2);
  });

  it('SPLIT은 새 노드들을 만들고 SPLIT_FROM 계보를 남긴다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const source = await activeFeature(projectId, '데이터 관리');
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'SPLIT',
        reason: '너무 커짐',
        targetFeatureIds: [source.id],
        proposedNodes: [{ name: '업로드' }, { name: '내보내기' }],
      },
    });
    await approveProposal(prisma, { projectId, userId, proposalId: proposal.id });
    const sourceAfter = await prisma.featureNode.findUniqueOrThrow({ where: { id: source.id } });
    expect(sourceAfter.lifecycle).toBe('RETIRED');
    const created = await prisma.featureNode.findMany({
      where: { projectId, name: { in: ['업로드', '내보내기'] } },
    });
    expect(created).toHaveLength(2);
    expect(await prisma.featureRelation.count({ where: { projectId, type: 'SPLIT_FROM' } })).toBe(
      2,
    );
  });

  it('MOVE는 순환을 거부한다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const parent = await activeFeature(projectId, '부모');
    const child = await activeFeature(projectId, '자식', parent.id);
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'MOVE',
        reason: '순환 이동',
        targetFeatureIds: [parent.id],
        newParentFeatureId: child.id,
      },
    });
    await expect(
      approveProposal(prisma, { projectId, userId, proposalId: proposal.id }),
    ).rejects.toThrow(/자기 자신/);
  });

  it('PENDING 제안은 수정할 수 있다', async () => {
    const { projectId, userId } = await createUserAndProject(prisma);
    const proposal = await createProposal(prisma, {
      input: {
        projectId,
        type: 'CREATE',
        reason: '초안 이유',
        proposedNode: { name: '알림' },
      },
    });
    const edited = await editProposal(prisma, {
      projectId,
      userId,
      proposalId: proposal.id,
      title: '수정된 제목',
      reason: '다듬은 이유',
    });
    expect(edited.title).toBe('수정된 제목');
    expect(edited.reason).toBe('다듬은 이유');
  });
});
