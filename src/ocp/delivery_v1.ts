import fs from 'fs-extra';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import { getDriver } from '../drivers';
import { EvidenceWriter } from '../evidence/evidence_writer';
import { getLogger } from '../logging/logger';
import { PolicyEngine } from '../policy/policy_engine';
import type {
  WebhookDeliveryInputV1,
  WebhookDeliveryOutputV1,
} from '../drivers/http_webhook_delivery_driver_v1';

const DRIVER_KIND = 'http_webhook_delivery_v1';
const MAX_PAYLOAD_BYTES = 1024;
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

export interface OcpDeliveryV1Request {
  target_url: string;
  payload?: any;
  metadata?: Record<string, unknown>;
  request_id?: string;
}

export interface OcpDeliveryV1Result {
  result_core: {
    request_id: string;
    run_id: string;
    driver_kind: string;
    target_url: string;
    delivered: boolean;
    status_code?: number;
    dry_run: false;
  };
  evidence: {
    request_id: string;
    run_id: string;
    evidence_dir: string;
    artifacts: {
      request: string;
      result_core: string;
      evidence: string;
    };
  };
}

function isAllowedHost(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function assertValidRequest(request: OcpDeliveryV1Request, signingSecret?: string): void {
  if (!request || typeof request !== 'object') {
    throw new Error('Delivery request must be an object');
  }

  if (!request.target_url || typeof request.target_url !== 'string') {
    throw new Error('Delivery target_url is required');
  }

  if (!isAllowedHost(request.target_url)) {
    throw new Error('Target host not allowlisted (only localhost/127.0.0.1)');
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify(request.payload ?? {}), 'utf8');
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload exceeds max size (${MAX_PAYLOAD_BYTES} bytes)`);
  }

  if (!signingSecret) {
    throw new Error('Signing secret is required for webhook delivery');
  }
}

const deliveryPolicy = new PolicyEngine();

deliveryPolicy.addRule({
  id: 'allow-real-send-local-only',
  action: 'allow',
  priority: 200,
  condition: (context: any) =>
    process.env.OCP_ENABLE_REAL_SEND === '1' &&
    context.metadata?.allow_real_send === true &&
    isAllowedHost(context.object_ref),
  description: 'Allow real webhook send only when explicitly enabled and allowlisted',
});

deliveryPolicy.addRule({
  id: 'deny-non-local-targets',
  action: 'deny',
  priority: 150,
  condition: (context: any) => !isAllowedHost(context.object_ref),
  description: 'Deny non-local targets',
});

deliveryPolicy.addRule({
  id: 'deny-missing-secret',
  action: 'deny',
  priority: 140,
  condition: (_context: any) => !process.env.WEBHOOK_SIGNING_SECRET,
  description: 'Signing secret required',
});

export async function runOcpDeliveryV1(
  request: OcpDeliveryV1Request
): Promise<OcpDeliveryV1Result> {
  const logger = getLogger();
  const signingSecret = process.env.WEBHOOK_SIGNING_SECRET;
  assertValidRequest(request, signingSecret);

  const policyDecision = deliveryPolicy.evaluate({
    subject_ref: 'ocp.delivery',
    object_ref: request.target_url,
    verb: 'ocp.delivery.v1',
    timestamp: new Date(),
    input: request,
    metadata: { allow_real_send: true },
  });

  if (!policyDecision.allowed) {
    throw new Error(`Delivery denied by policy: ${policyDecision.reason || 'not allowed'}`);
  }

  const requestId = request.request_id ?? `req_${randomUUID()}`;
  const runId = `run_${randomUUID()}`;
  const evidenceDir = path.join('artifacts', 'ocp_delivery_v1', requestId, 'runs', runId);
  await fs.ensureDir(evidenceDir);

  const driver = getDriver(DRIVER_KIND);
  const payload = request.payload ?? {};

  const bodyHash = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  const targetHost = new URL(request.target_url).hostname;

  const driverInput: WebhookDeliveryInputV1 = {
    target_url: request.target_url,
    payload,
    signing_secret: signingSecret || '',
    timeout_ms: 5000,
  };

  const driverResult = (await driver.execute(driverInput, {
    driverName: DRIVER_KIND,
  })) as WebhookDeliveryOutputV1;

  const delivered = driverResult.status >= 200 && driverResult.status < 300;

  const resultCore = {
    request_id: requestId,
    run_id: runId,
    driver_kind: DRIVER_KIND,
    target_url: request.target_url,
    delivered,
    status_code: driverResult.status,
    dry_run: false as const,
  };

  const evidenceWriter = new EvidenceWriter();
  await evidenceWriter.writeArtifact(evidenceDir, 'request.json', {
    ...request,
    target_url: request.target_url,
    payload,
    metadata: request.metadata,
  });
  await evidenceWriter.writeArtifact(evidenceDir, 'result_core.json', resultCore);
  await evidenceWriter.writeArtifact(evidenceDir, 'evidence.json', {
    policy_allowed: policyDecision.allowed,
    policy_reason: policyDecision.reason,
    target_host: targetHost,
    request_body_sha256: bodyHash,
    response_status: driverResult.status,
    response_body_sha256: driverResult.response_body_sha256,
    duration_ms: driverResult.duration_ms,
    timestamp: new Date().toISOString(),
  });

  logger.info(`OCP delivery v1 webhook run recorded at ${evidenceDir}`);

  return {
    result_core: resultCore,
    evidence: {
      request_id: requestId,
      run_id: runId,
      evidence_dir: evidenceDir,
      artifacts: {
        request: path.join(evidenceDir, 'request.json'),
        result_core: path.join(evidenceDir, 'result_core.json'),
        evidence: path.join(evidenceDir, 'evidence.json'),
      },
    },
  };
}
