/**
 * 도메인 오류. API 레이어에서 HTTP 상태코드와 사용자 친화적 메시지로 변환된다.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class NotFoundError extends DomainError {
  constructor(message = '요청한 대상을 찾을 수 없습니다.') {
    super('NOT_FOUND', message, 404);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = '이 작업을 수행할 권한이 없습니다.') {
    super('FORBIDDEN', message, 403);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = '인증이 필요합니다.') {
    super('UNAUTHORIZED', message, 401);
  }
}
