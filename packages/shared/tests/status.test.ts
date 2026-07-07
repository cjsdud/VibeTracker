import { describe, expect, it } from 'vitest';
import {
  bootstrapProjectMapInput,
  deriveDisplayStatus,
  proposeStructureChangeInput,
  recordWorkUpdateInput,
  summarizeFeatures,
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

  it('구현됐지만 검증이 없으면 "완성"이 아니라 "검증 필요"다', () => {
    // bootstrap 직후 흔한 상태: 구현됨 + 확인 없음 → 사용자에게 "부족한 부분"으로 보여야 한다
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'IMPLEMENTED',
        verificationStatus: 'UNKNOWN',
      }),
    ).toBe('NEEDS_VERIFICATION');
    // 일부 구현은 검증 여부와 무관하게 "작업 중"
    expect(
      deriveDisplayStatus({
        lifecycle: 'ACTIVE',
        implementationStatus: 'PARTIAL',
        verificationStatus: 'NEEDS_VERIFICATION',
      }),
    ).toBe('IN_PROGRESS');
  });
});

describe('summarizeFeatures (진행 요약)', () => {
  const leaf = (displayStatus: string, lifecycle = 'ACTIVE') =>
    ({ displayStatus, lifecycle, children: [] }) as never;

  it('leaf 기능만 세고 영역(부모)과 종료 기능은 제외한다', () => {
    const summary = summarizeFeatures([
      {
        displayStatus: 'IMPLEMENTED',
        lifecycle: 'ACTIVE',
        children: [leaf('IMPLEMENTED'), leaf('NEEDS_VERIFICATION'), leaf('RETIRED', 'RETIRED')],
      } as never,
      leaf('PLANNED'),
      leaf('RETIRED', 'RETIRED'),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.done).toBe(1);
    expect(summary.counts.NEEDS_VERIFICATION).toBe(1);
    expect(summary.counts.PLANNED).toBe(1);
  });

  it('종료된 부모 아래의 살아있는 자식도 집계한다', () => {
    const summary = summarizeFeatures([
      {
        displayStatus: 'RETIRED',
        lifecycle: 'RETIRED',
        children: [leaf('IMPLEMENTED'), leaf('PLANNED')],
      } as never,
    ]);
    expect(summary.total).toBe(2);
    expect(summary.done).toBe(1);
  });

  it('자식이 전부 종료된 부모는 leaf로 취급한다', () => {
    const summary = summarizeFeatures([
      {
        displayStatus: 'IMPLEMENTED',
        lifecycle: 'ACTIVE',
        children: [leaf('RETIRED', 'RETIRED')],
      } as never,
    ]);
    expect(summary.total).toBe(1);
    expect(summary.done).toBe(1);
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
