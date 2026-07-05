import { type FastifyReply, type FastifyRequest } from 'fastify';
import { UnauthorizedError, type PrismaClient, type User } from '@vibetrack/tracker-core';

export const SESSION_COOKIE = 'vt_session';

export function setSessionCookie(reply: FastifyReply, userId: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, userId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function getSessionUserId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return unsigned.value;
}

/** 세션 필수 라우트에서 호출. 없으면 401. */
export async function requireUser(prisma: PrismaClient, request: FastifyRequest): Promise<User> {
  const userId = getSessionUserId(request);
  if (!userId) throw new UnauthorizedError('로그인이 필요합니다.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError('세션이 만료되었습니다. 다시 로그인하세요.');
  return user;
}
