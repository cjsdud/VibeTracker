import { randomBytes } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { UnauthorizedError, ValidationError } from '@vibetrack/tracker-core';
import { type UserDto } from '@vibetrack/shared';
import { type AppContext } from '../app.js';
import {
  clearSessionCookie,
  getSessionUserId,
  requireUser,
  setSessionCookie,
} from '../auth/session.js';
import { ensureDemoData } from '../demo/seed.js';

function toUserDto(user: {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  isDemo: boolean;
}): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    isDemo: user.isDemo,
  };
}

export async function authRoutes(app: FastifyInstance, opts: { ctx: AppContext }): Promise<void> {
  const { prisma, env, github } = opts.ctx;
  const secureCookie = env.NODE_ENV === 'production';

  app.get('/api/auth/me', async (request) => {
    const userId = getSessionUserId(request);
    if (!userId) return { user: null };
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return { user: user ? toUserDto(user) : null };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  // 데모 로그인: DEMO_MODE에서만. 데모 사용자와 데모 데이터를 보장한다.
  app.post('/api/auth/demo-login', async (request, reply) => {
    if (!env.DEMO_MODE) {
      throw new UnauthorizedError('데모 모드가 꺼져 있습니다. GitHub로 로그인하세요.');
    }
    const { user } = await ensureDemoData(prisma);
    setSessionCookie(reply, user.id, secureCookie);
    return { user: toUserDto(user) };
  });

  // GitHub OAuth 로그인 (자격증명이 있을 때만 동작하는 adapter)
  app.get('/api/auth/github', async (request, reply) => {
    if (!github.hasOAuth() || !env.GITHUB_CLIENT_ID) {
      throw new ValidationError(
        'GitHub 로그인이 설정되지 않았습니다. DEMO_MODE로 시작하거나 GITHUB_CLIENT_ID/SECRET을 설정하세요.',
      );
    }
    const state = randomBytes(16).toString('hex');
    reply.setCookie('vt_oauth_state', state, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
      path: '/',
      maxAge: 600,
    });
    const redirectUri = `${env.APP_URL}/api/auth/github/callback`;
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  app.get('/api/auth/github/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    const stateCookie = request.cookies['vt_oauth_state'];
    const unsigned = stateCookie ? request.unsignCookie(stateCookie) : null;
    if (!query.code || !query.state || !unsigned?.valid || unsigned.value !== query.state) {
      throw new UnauthorizedError('GitHub 로그인 검증에 실패했습니다. 다시 시도하세요.');
    }
    reply.clearCookie('vt_oauth_state', { path: '/' });

    const { token } = await github.exchangeOAuthCode(query.code);
    const profile = await github.getOAuthUser(token);
    const user = await prisma.user.upsert({
      where: { githubId: BigInt(profile.githubId) },
      update: {
        name: profile.name,
        githubLogin: profile.login,
        avatarUrl: profile.avatarUrl,
        ...(profile.email ? { email: profile.email } : {}),
      },
      create: {
        name: profile.name,
        email: profile.email,
        githubId: BigInt(profile.githubId),
        githubLogin: profile.login,
        avatarUrl: profile.avatarUrl,
      },
    });

    // 사용자가 접근 가능한 GitHub App 설치를 동기화한다 (저장소 연결에 사용)
    try {
      const installations = await github.listUserInstallations(token);
      for (const inst of installations) {
        await prisma.githubInstallation.upsert({
          where: { installationId: BigInt(inst.id) },
          update: { userId: user.id, accountLogin: inst.accountLogin },
          create: {
            userId: user.id,
            installationId: BigInt(inst.id),
            accountLogin: inst.accountLogin,
          },
        });
      }
    } catch (error) {
      request.log.warn({ err: error }, 'GitHub 설치 목록 동기화 실패');
    }

    setSessionCookie(reply, user.id, secureCookie);
    return reply.redirect(env.NODE_ENV === 'production' ? '/' : env.APP_URL);
  });

  // 세션 확인용 (테스트에서도 사용)
  app.get('/api/auth/session-check', async (request) => {
    const user = await requireUser(prisma, request);
    return { user: toUserDto(user) };
  });
}
