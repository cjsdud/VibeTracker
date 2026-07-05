import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * GitHub webhook `X-Hub-Signature-256` 검증.
 * 반드시 파싱 전 원문(raw body) 기준으로 검증해야 한다.
 */
export function verifyWebhookSignature(params: {
  secret: string;
  rawBody: string | Buffer;
  signatureHeader: string | undefined;
}): boolean {
  const { secret, rawBody, signatureHeader } = params;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
