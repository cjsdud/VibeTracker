import { describe, expect, it } from 'vitest';
import { assessFeatureMapQuality, type MapQualityWarning } from '../src/index.js';

const codes = (warnings: MapQualityWarning[]) => warnings.map((w) => w.code);

describe('assessFeatureMapQuality (기능 지도 품질 점검)', () => {
  it('기술 용어 이름을 잡는다 — 실제로 나빴던 지도의 이름들', () => {
    const warnings = assessFeatureMapQuality([
      { name: 'MCP 엔드포인트', description: '설명 있음이지만 이름이 문제' },
      { name: 'Webhook 수신과 서명 검증', description: '한 줄 설명입니다' },
      { name: '비동기 작업 큐', description: '한 줄 설명입니다' },
      { name: 'API 토큰 관리', description: '한 줄 설명입니다' },
    ]);
    expect(codes(warnings)).toEqual(['TECH_NAME', 'TECH_NAME', 'TECH_NAME', 'TECH_NAME']);
    expect(warnings[0]?.message).toContain('MCP 엔드포인트');
  });

  it('좋은 이름은 잡지 않는다 — 영어 단어 경계와 한국어 오탐 방지', () => {
    const warnings = assessFeatureMapQuality([
      { name: 'Claude Code에서 프로젝트 상태 읽고 쓰기', description: '작업 시작 전 맥락 조회' },
      { name: 'GitHub 활동 자동 반영', description: '푸시가 지도에 반영된다' },
      { name: '시작하기와 로그인', description: '데모 계정으로 체험' },
      { name: '바베큐 주문', description: '음식 주문 기능 (큐 오탐 방지)' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('파일 경로 같은 이름을 잡는다', () => {
    const warnings = assessFeatureMapQuality([
      { name: 'src/utils', description: '한 줄 설명입니다' },
      { name: 'featureTree.ts', description: '한 줄 설명입니다' },
    ]);
    expect(codes(warnings)).toEqual(['PATH_NAME', 'PATH_NAME']);
  });

  it('설명이 없거나 너무 짧으면 잡는다 (자식 노드 포함)', () => {
    const warnings = assessFeatureMapQuality([
      {
        name: '시작하기',
        description: '가입 없이 데모로 체험할 수 있다',
        children: [{ name: '데모로 둘러보기' }, { name: '로그인', description: 'ok' }],
      },
    ]);
    expect(codes(warnings).sort()).toEqual(['NO_DESCRIPTION', 'NO_DESCRIPTION']);
    expect(warnings.map((w) => w.featureName).sort()).toEqual(['데모로 둘러보기', '로그인']);
  });

  it('최상위 영역이 7개를 넘으면 잡는다', () => {
    const warnings = assessFeatureMapQuality(
      Array.from({ length: 8 }, (_, i) => ({ name: `영역 ${i + 1}`, description: '한 줄 설명' })),
    );
    expect(codes(warnings)).toEqual(['TOO_MANY_AREAS']);
  });

  it('40자를 넘는 이름을 잡는다', () => {
    const longName = '사용자가 결제를 완료하면 이메일과 푸시 알림을 동시에 보내고 관리자 대시보드에도 표시하는 기능';
    const warnings = assessFeatureMapQuality([{ name: longName, description: '한 줄 설명입니다' }]);
    expect(codes(warnings)).toEqual(['LONG_NAME']);
  });
});
