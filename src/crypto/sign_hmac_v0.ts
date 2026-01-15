import { createHash, createHmac } from 'crypto';

export interface SignedPayload {
  timestamp: string;
  bodySha256: string;
  signature: string;
}

/**
 * Produce deterministic HMAC signature over `${timestamp}.${bodySha256}`.
 */
export function signPayload(body: string, secret: string, timestamp?: string): SignedPayload {
  const ts = timestamp ?? new Date().toISOString();
  const bodySha256 = createHash('sha256').update(body, 'utf8').digest('hex');
  const sig = createHmac('sha256', secret).update(`${ts}.${bodySha256}`, 'utf8').digest('hex');
  return { timestamp: ts, bodySha256, signature: sig };
}
