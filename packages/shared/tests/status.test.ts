import { describe, expect, it } from 'vitest';
import {
  bootstrapProjectMapInput,
  deriveDisplayStatus,
  proposeStructureChangeInput,
  recordWorkUpdateInput,
} from '../src/index.js';

describe('deriveDisplayStatus', () => {
  it('생명주기가 상태 축보다 우선한다', () => {
    expect(
      deriveDisplayStatus({
        lifecycle: 'RETIRED',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'PASSED',
      }),
    ).toBe('RETIRED');
    expect(
      deriveDisplayStatus({
        lifecycle: 'DRAFT',
        implementationStatus: 'NOT_STARTED',
        verificationStatus: 'UNKNOWN',
      }),
    ).toBe('AWAITING_APPROVAL');
  });

  it('테스트 실패는 다른 어떤 상태보다 우선한다', () => {
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'FAILED',
      }),
    ).toBe('BROKEN');
  });

  it('구현/검증 조합이 사람이 읽는 상태로 요약된다', () => {
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'NOT_STARTED',
        verificationStatus: 'UNKNOWN',
      }),
    ).toBe('PLANNED');
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'PARTIAL',
        verificationStatus: 'UNKNOWN',
      }),
    ).toBe('IN_PROGRESS');
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'PASSED',
      }),
    ).toBe('IMPLEMENTED');
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'CHANGED',
        verificationStatus: 'NEEDS_VERIFICATION',
      }),
    ).toBe('NEEDS_VERIFICATION');
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'CHANGED',
        verificationStatus: 'UNKNOWN',
      }),
    ).toBe('NEEDS_VERIFICATION');
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'MANUAL_VERIFIED',
      }),
    ).toBe('IMPLEMENTED');
  });
});

describe('MCP 입력 스키마', () => {
  it('bootstrap은 최소 1개 기능이 필요하고 재귀 children을 허용한다', () => {
    expect(() => bootstrapProjectMapInput.parse({ projectId: 'p', features: [] })).toThrow();
    const parsed = bootstrapProjectMapInput.parse({
      projectId: 'p',
      features: [{ name: 'A', children: [{ name: 'B', children: [{ name: 'C' }] }] }],
    });
    expect(parsed.features[0]?.children?.[0]?.children?.[0]?.name).toBe('C');
  });

  it('record_work_update는 summary가 필수다', () => {
    expect(() => recordWorkUpdateInput.parse({ projectId: 'p' })).toThrow();
    expect(recordWorkUpdateInput.parse({ projectId: 'p', summary: '작업' }).summary).toBe('작업');
  });

  it('propose_structure_change는 타입별 필수 조합을 검증한다', () => {
    expect(() =>
      proposeStructureChangeInput.parse({ projectId: 'p', type: 'CREATE', reason: 'r' }),
    ).toThrow(/proposedNode/);
    expect(() =>
      proposeStructureChangeInput.parse({
        projectId: 'p',
        type: 'MERGE',
        reason: 'r',
        targetFeatureIds: ['a'],
      }),
    ).toThrow(/2개 이상/);
    expect(() =>
      proposeStructureChangeInput.parse({
        projectId: 'p',
        type: 'SPLIT',
        reason: 'r',
        targetFeatureIds: ['a'],
        proposedNodes: [{ name: 'X' }],
      }),
    ).toThrow(/proposedNodes/);
    const valid = proposeStructureChangeInput.parse({
      projectId: 'p',
      type: 'RENAME',
      reason: 'r',
      targetFeatureIds: ['a'],
      newName: '새 이름',
    });
    expect(valid.newName).toBe('새 이름');
  });
});
