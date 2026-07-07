import { type Prisma } from '../db.js';

/**
 * "검증 필요"의 단일 정의 — 표시 상태(deriveDisplayStatus)와 동일한 의미:
 * 구현은 됐지만(IMPLEMENTED/CHANGED) 아직 확인이 없는(UNKNOWN/NEEDS_VERIFICATION) 활성 기능.
 * FAILED는 별도 버킷('문제 있음')으로, get_next_task 1순위가 처리한다.
 *
 * 대시보드 카운트, MCP 프로젝트 컨텍스트, get_next_task가 모두 이 정의를 공유해야
 * 화면마다 숫자가 어긋나지 않는다.
 */
export const needsVerificationWhere: Prisma.FeatureNodeWhereInput = {
  lifecycle: 'ACTIVE',
  implementationStatus: { in: ['IMPLEMENTED', 'CHANGED'] },
  verificationStatus: { in: ['UNKNOWN', 'NEEDS_VERIFICATION'] },
};
