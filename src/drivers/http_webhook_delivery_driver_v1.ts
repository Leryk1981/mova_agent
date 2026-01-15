import { Driver, DriverContext } from '@leryk1981/mova-executors';
import { signPayload } from '../crypto/sign_hmac_v0';

export interface WebhookDeliveryInputV1 {
  target_url: string;
  payload: any;
  signing_secret: string;
  timeout_ms?: number;
}

export interface WebhookDeliveryOutputV1 {
  status: number;
  duration_ms: number;
  response_body?: string;
  response_body_sha256?: string;
}

async function postJsonWithHmac(
  targetUrl: string,
  payload: any,
  signingSecret: string,
  timeoutMs: number
): Promise<WebhookDeliveryOutputV1> {
  const fetchFn: any = (globalThis as any).fetch;
  const AbortCtrl: any = (globalThis as any).AbortController;

  if (!fetchFn || !AbortCtrl) {
    throw new Error('Fetch/AbortController not available in runtime');
  }

  const body = JSON.stringify(payload ?? {});
  const { timestamp, bodySha256, signature } = signPayload(body, signingSecret);

  const controller = new AbortCtrl();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetchFn(targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mova-ts': timestamp,
        'x-mova-body-sha256': bodySha256,
        'x-mova-sig': signature,
      },
      body,
      signal: controller.signal,
    });

    const duration_ms = Date.now() - started;
    const responseBody = await response.text();
    const responseBodySha256 =
      responseBody && responseBody.length > 0
        ? signPayload(responseBody, signingSecret, timestamp).bodySha256
        : undefined;

    return {
      status: response.status,
      duration_ms,
      response_body: responseBody || undefined,
      response_body_sha256: responseBodySha256,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { status: 408, duration_ms: Date.now() - started, response_body: 'timeout' };
    }
    return { status: 500, duration_ms: Date.now() - started, response_body: error.message };
  } finally {
    clearTimeout(timer);
  }
}

export function httpWebhookDeliveryDriverV1Factory(): Driver {
  return {
    async execute(
      input: WebhookDeliveryInputV1,
      _context?: DriverContext
    ): Promise<WebhookDeliveryOutputV1> {
      const timeout = input.timeout_ms ?? 5000;
      return postJsonWithHmac(input.target_url, input.payload ?? {}, input.signing_secret, timeout);
    },
  };
}
