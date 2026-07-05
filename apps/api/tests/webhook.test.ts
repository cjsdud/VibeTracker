import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildTestApp, createTestDb, demoLogin, resetDb } from './helpers.js';

const prisma = createTestDb();
const secret = 'test-webhook-secret';

function sign(body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function postWebhook(
  app: FastifyInstance,
  opts: { body: string; signature?: string; deliveryId?: string; event?: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/github/webhook',
    payload: opts.body,
    headers: {
      'content-type': 'application/json',
      ...(opts.signature ? { 'x-hub-signature-256': opts.signature } : {}),
      'x-github-delivery': opts.deliveryId ?? 'delivery-1',
      'x-github-event': opts.event ?? 'push',
    },
  });
}

describe('GitHub webhook endpoint', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb(prisma);
    app = await buildTestApp(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('서명이 없거나 틀리면 401로 거부하고 아무것도 저장하지 않는다', async () => {
    const body = JSON.stringify({ repository: { full_name: 'a/b' }, commits: [] });
    const noSig = await postWebhook(app, { body });
    expect(noSig.statusCode).toBe(401);
    const badSig = await postWebhook(app, { body, signature: 'sha256=' + '0'.repeat(64) });
    expect(badSig.statusCode).toBe(401);
    expect(await prisma.githubEvent.count()).toBe(0);
  });

  it('유효한 서명은 202로 저장하고 Job을 만든다', async () => {
    const body = JSON.stringify({
      repository: { full_name: 'demo/review-insight' },
      ref: 'refs/heads/main',
      commits: [],
    });
    const response = await postWebhook(app, { body, signature: sign(body) });
    expect(response.statusCode).toBe(202);
    expect(await prisma.githubEvent.count()).toBe(1);
    expect(await prisma.job.count({ where: { type: 'process_github_event' } })).toBe(1);
  });

  it('같은 delivery ID는 중복 저장/처리되지 않는다', async () => {
    const body = JSON.stringify({ repository: { full_name: 'a/b' }, commits: [] });
    const first = await postWebhook(app, { body, signature: sign(body), deliveryId: 'dup-1' });
    expect(first.statusCode).toBe(202);
    const second = await postWebhook(app, { body, signature: sign(body), deliveryId: 'dup-1' });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true });
    expect(await prisma.githubEvent.count()).toBe(1);
    expect(await prisma.job.count()).toBe(1);
  });

  it('secret 미설정이면 503을 반환한다', async () => {
    const bare = await buildTestApp(prisma, { GITHUB_WEBHOOK_SECRET: '' });
    const body = JSON.stringify({});
    const response = await postWebhook(bare, { body, signature: sign(body) });
    expect(response.statusCode).toBe(503);
  });
});

describe('project isolation over HTTP', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb(prisma);
    app = await buildTestApp(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('다른 사용자의 프로젝트는 404이고 목록에도 보이지 않는다', async () => {
    const cookie = await demoLogin(app);
    // 다른 사용자 소유 프로젝트
    const stranger = await prisma.user.create({ data: { name: '남' } });
    const strangerProject = await prisma.project.create({
      data: { userId: stranger.id, name: '남의 프로젝트' },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie },
    });
    const names = (list.json() as { projects: { name: string }[] }).projects.map((p) => p.name);
    expect(names).not.toContain('남의 프로젝트');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/projects/${strangerProject.id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(404);

    const features = await app.inject({
      method: 'GET',
      url: `/api/projects/${strangerProject.id}/features`,
      headers: { cookie },
    });
    expect(features.statusCode).toBe(404);
  });

  it('세션 없는 요청은 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });
});
