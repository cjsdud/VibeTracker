import { type BootstrapNodeInput } from './mcp-schemas.js';

/**
 * 기능 지도 초안의 품질을 규칙 기반으로 점검한다 (VibeTrack 자체 LLM 없음 원칙).
 * bootstrap_project_map 결과에 실려 Claude Code가 스스로 이름/설명을 고쳐
 * 재등록하도록 유도하고, Inbox 검토 항목에도 표시된다.
 *
 * 목표는 "개발을 모르는 사람이 이름만 읽고 무슨 기능인지 아는 지도".
 * 여기서 잡는 것은 그 목표를 확실히 깨는 패턴만이다 — 기술 용어 이름,
 * 파일 경로 이름, 설명 없음, 영역 과다, 과도하게 긴 이름.
 */

export type MapQualityCode =
  | 'TECH_NAME'
  | 'PATH_NAME'
  | 'NO_DESCRIPTION'
  | 'TOO_MANY_AREAS'
  | 'LONG_NAME';

export interface MapQualityWarning {
  code: MapQualityCode;
  featureName?: string;
  message: string;
}

// 영어 용어는 단어 경계로만 매칭한다 ("Claude Code 연동"의 Code는 잡지 않는다)
const TECH_TERMS_EN = [
  'api',
  'mcp',
  'webhook',
  'endpoint',
  'db',
  'sql',
  'orm',
  'schema',
  'middleware',
  'queue',
  'cron',
  'cache',
  'sdk',
  'http',
  'https',
  'jwt',
  'oauth',
  'backend',
  'frontend',
  'json',
  'migration',
];
const TECH_TERMS_EN_RE = new RegExp(`\\b(${TECH_TERMS_EN.join('|')})\\b`, 'i');

const TECH_TERMS_KO = [
  '엔드포인트',
  '웹훅',
  '미들웨어',
  '스키마',
  '마이그레이션',
  '데이터베이스',
  '캐시',
  '백엔드',
  '프론트엔드',
  '쿼리',
  '트랜잭션',
  '리팩터링',
  '리팩토링',
];
// '큐'는 한 글자라 단독 어절일 때만 잡는다 ("비동기 작업 큐"는 잡고 "바베큐"는 안 잡는다)
const KO_QUEUE_RE = /(^|[\s(·])큐([\s)·]|$)/;

const PATH_LIKE_RE = /[\\/]|\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|css|scss|html|json|ya?ml|md|sql|prisma)$/i;

function techTermsIn(name: string): string[] {
  const found: string[] = [];
  const en = name.match(new RegExp(TECH_TERMS_EN_RE, 'gi'));
  if (en) found.push(...new Set(en.map((t) => t.toUpperCase())));
  for (const term of TECH_TERMS_KO) {
    if (name.includes(term)) found.push(term);
  }
  if (KO_QUEUE_RE.test(name)) found.push('큐');
  return found;
}

export function assessFeatureMapQuality(features: BootstrapNodeInput[]): MapQualityWarning[] {
  const warnings: MapQualityWarning[] = [];

  if (features.length > 7) {
    warnings.push({
      code: 'TOO_MANY_AREAS',
      message: `최상위 영역이 ${features.length}개입니다. 사용자가 서비스를 쓰는 순서대로 3~6개 영역으로 묶는 편이 읽기 쉽습니다.`,
    });
  }

  const visit = (node: BootstrapNodeInput): void => {
    const name = node.name.trim();

    const terms = techTermsIn(name);
    if (terms.length > 0) {
      warnings.push({
        code: 'TECH_NAME',
        featureName: name,
        message: `"${name}": 이름에 기술 용어(${terms.join(', ')})가 있습니다. 그 기술이 사용자에게 해주는 일로 바꾸세요. (예: "Webhook 수신" → "GitHub 활동 자동 반영")`,
      });
    } else if (PATH_LIKE_RE.test(name)) {
      warnings.push({
        code: 'PATH_NAME',
        featureName: name,
        message: `"${name}": 파일/폴더 경로처럼 보입니다. 사용자 관점의 기능 이름으로 바꾸고 경로는 evidence.files에 넣으세요.`,
      });
    }

    if (!node.description || node.description.trim().length < 5) {
      warnings.push({
        code: 'NO_DESCRIPTION',
        featureName: name,
        message: `"${name}": 한 줄 설명(description)이 없습니다. "누가 무엇을 할 수 있다" 형식으로 채우세요.`,
      });
    }

    if (name.length > 40) {
      warnings.push({
        code: 'LONG_NAME',
        featureName: name,
        message: `"${name}": 이름이 40자를 넘습니다. 핵심 행동만 남기고 나머지는 description으로 옮기세요.`,
      });
    }

    for (const child of node.children ?? []) visit(child);
  };
  for (const root of features) visit(root);

  return warnings;
}
