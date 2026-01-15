import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDriver } from '../drivers';
import { EvidenceWriter } from '../evidence/evidence_writer';
import { getLogger } from '../logging/logger';
import { PolicyEngine } from '../policy/policy_engine';

const DRIVER_KIND = 'noop_webhook_v0';
const MAX_PAYLOAD_BYTES = 1024;

function isForbiddenTarget(target: string): boolean {
  return target.startsWith('http://') || target.startsWith('https://');
}

export interface WebhookRequestV0 {
  target: string;
  payload?: any;
  dry_run?: boolean;
  metadata?: Record<string, unknown>;
  request_id?: string;
}

export interface WebhookResultV0 {
  result_core: {
    request_id: string;
    run_id: string;
    driver_kind: string;
    target: string;
    dry_run: boolean;
    delivered: false;
    status: 'noop';
    evidence_dir: string;
    driver_echo: any;
  };
  evidence: {
    request_id: string;
    run_id: string;
    evidence_dir: string;
    artifacts: {
      request: string;
      result_core: string;
      driver_result: string;
    };
  };
}

const webhookPolicy = new PolicyEngine();

webhookPolicy.addRule({
  id: 'allow-noop-webhook-v0',
  action: 'allow',
  priority: 200,
  condition: (context: any) =>
    process.env.ALLOW_NOOP_ONLY === 'true' &&
    context.metadata?.driver_kind === DRIVER_KIND &&
    context.metadata?.dry_run !== false &&
    !isForbiddenTarget(context.object_ref),
  description: 'Allow noop webhook only when ALLOW_NOOP_ONLY=true and dry_run enforced',
});

webhookPolicy.addRule({
  id: 'deny-non-noop-webhook-v0',
  action: 'deny',
  priority: 150,
  condition: (context: any) => context.metadata?.driver_kind !== DRIVER_KIND,
  description: 'Only noop_webhook_v0 driver is permitted in v0',
});

webhookPolicy.addRule({
  id: 'deny-forbidden-webhook-targets-v0',
  action: 'deny',
  priority: 120,
  condition: (context: any) => typeof context.object_ref === 'string' && isForbiddenTarget(context.object_ref),
  description: 'Real endpoints are forbidden in v0',
});

function assertValidRequest(request: WebhookRequestV0): void {
  if (!request || typeof request !== 'object') {
    throw new Error('Webhook request must be an object');
  }

  if (!request.target || typeof request.target !== 'string') {
    throw new Error('Webhook target is required');
  }

  if (isForbiddenTarget(request.target)) {
    throw new Error('Real endpoints are forbidden in v0');
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify(request.payload ?? {}), 'utf8');
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload exceeds max size (${MAX_PAYLOAD_BYTES} bytes)`);
  }

  if (request.dry_run === false) {
    throw new Error('Real webhook calls are not supported in v0 (dry_run must be true)');
  }
}

export async function runExternalCallWebhookV0(
  request: WebhookRequestV0
): Promise<WebhookResultV0> {
  const logger = getLogger();
  assertValidRequest(request);

  const normalizedRequest: WebhookRequestV0 = {
    ...request,
    dry_run: request.dry_run !== false,
  };

  const policyDecision = webhookPolicy.evaluate({
    subject_ref: 'ocp.external_call.webhook',
    object_ref: normalizedRequest.target,
    verb: 'ocp.external_call.webhook.v0',
    timestamp: new Date(),
    input: normalizedRequest,
    metadata: { driver_kind: DRIVER_KIND, dry_run: normalizedRequest.dry_run },
  });

  if (!policyDecision.allowed) {
    throw new Error(
      `Webhook denied by policy: ${policyDecision.reason || 'ALLOW_NOOP_ONLY must be true'}`
    );
  }

  const requestId = normalizedRequest.request_id ?? `req_${randomUUID()}`;
  const runId = `run_${randomUUID()}`;
  const evidenceDir = path.join('artifacts', 'external_call_webhook_v0', requestId, 'runs', runId);
  await fs.ensureDir(evidenceDir);

  const driver = getDriver(DRIVER_KIND);
  const driverResult = await driver.execute(
    { ...normalizedRequest, request_id: requestId, run_id: runId, dry_run: true },
    { driverName: DRIVER_KIND }
  );

  const evidenceWriter = new EvidenceWriter();
  await evidenceWriter.writeArtifact(evidenceDir, 'request.json', normalizedRequest);

  const resultCore = {
    request_id: requestId,
    run_id: runId,
    driver_kind: DRIVER_KIND,
    target: normalizedRequest.target,
    dry_run: true,
    delivered: false as const,
    status: 'noop' as const,
    evidence_dir: evidenceDir,
    driver_echo: driverResult,
  };

  await evidenceWriter.writeArtifact(evidenceDir, 'result_core.json', resultCore);
  await evidenceWriter.writeArtifact(evidenceDir, 'driver_result.json', driverResult);

  logger.info(`Webhook noop run recorded at ${evidenceDir}`);

  return {
    result_core: resultCore,
    evidence: {
      request_id: requestId,
      run_id: runId,
      evidence_dir: evidenceDir,
      artifacts: {
        request: path.join(evidenceDir, 'request.json'),
        result_core: path.join(evidenceDir, 'result_core.json'),
        driver_result: path.join(evidenceDir, 'driver_result.json'),
      },
    },
  };
}
