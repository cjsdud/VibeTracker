import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../src/signature.js';

const secret = 'test-webhook-secret';
const body = JSON.stringify({ hello: 'world' });
const sign = (payload: string, key = secret) =>
  `sha256=${createHmac('sha256', key).update(payload).digest('hex')}`;

describe('webhook signature validation', () => {
  it('올바른 서명은 통과한다', () => {
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader: sign(body) })).toBe(
      true,
    );
    expect(
      verifyWebhookSignature({
        secret,
        rawBody: Buffer.from(body),
        signatureHeader: sign(body),
      }),
    ).toBe(true);
  });

  it('서명이 없거나 형식이 다르면 거부한다', () => {
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader: undefined })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader: 'sha1=abcdef' })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader: 'sha256=' })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader: 'sha256=zzzz' })).toBe(
      false,
    );
  });

  it('다른 secret이나 변조된 본문은 거부한다', () => {
    expect(
      verifyWebhookSignature({ secret, rawBody: body, signatureHeader: sign(body, 'other') }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        rawBody: body + 'tampered',
        signatureHeader: sign(body),
      }),
    ).toBe(false);
  });
});
