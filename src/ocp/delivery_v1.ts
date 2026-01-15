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
import { IdempotencyStoreV0, IDEMPOTENCY_ERRORS } from './idempotency_store_v0';
import { runWithRetry, RetryAttemptLog } from './retry_backoff_v0';

const DEFAULT_POLICY_ID = 'ocp_delivery_dev_local_v0';

export interface OcpDeliveryV1Request {
  target_url: string;
  payload?: any;
  metadata?: Record<string, unknown>;
  request_id?: string;
  idempotency_key?: string;
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

function loadPolicyProfile(): { profileId: string; policy: any } {
  const profileId = process.env.OCP_POLICY_PROFILE_ID || DEFAULT_POLICY_ID;
  const policyPath = path.resolve(process.cwd(), 'policies', 'ocp_delivery', `${profileId}.json`);
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Policy profile not found: ${profileId}`);
  }
  return { profileId, policy: fs.readJsonSync(policyPath) };
}

function hostAllowed(urlString: string, allowed: string[]): boolean {
  try {
    const parsed = new URL(urlString);
    return allowed.some((item) => item === parsed.hostname);
  } catch {
    return false;
  }
}

function assertValidRequest(
  request: OcpDeliveryV1Request,
  policy: any,
  signingSecret?: string
): void {
  if (!request || typeof request !== 'object') {
    throw new Error('Delivery request must be an object');
  }

  if (!request.target_url || typeof request.target_url !== 'string') {
    throw new Error('Delivery target_url is required');
  }

  if (!hostAllowed(request.target_url, policy.allowed_targets || [])) {
    throw new Error('Target host not allowlisted by policy');
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify(request.payload ?? {}), 'utf8');
  const maxBytes = policy.max_payload_bytes ?? 0;
  if (maxBytes > 0 && payloadBytes > maxBytes) {
    throw new Error(`Payload exceeds max size (${maxBytes} bytes)`);
  }

  if (policy.require_hmac && !signingSecret) {
    throw new Error('Signing secret is required for webhook delivery');
  }
}

export async function runOcpDeliveryV1(
  request: OcpDeliveryV1Request
): Promise<OcpDeliveryV1Result> {
  const logger = getLogger();
  const signingSecret = process.env.WEBHOOK_SIGNING_SECRET;
  const { profileId, policy } = loadPolicyProfile();
  assertValidRequest(request, policy, signingSecret);

  const deliveryPolicy = new PolicyEngine();
  deliveryPolicy.addRule({
    id: 'allow-real-send-policy',
    action: 'allow',
    priority: 200,
    condition: (context: any) =>
      process.env.OCP_ENABLE_REAL_SEND === '1' &&
      policy.allow_real_send === true &&
      hostAllowed(context.object_ref, policy.allowed_targets || []),
    description: 'Policy allow real send with env arming switch',
  });

  deliveryPolicy.addRule({
    id: 'deny-not-allowed-host',
    action: 'deny',
    priority: 150,
    condition: (context: any) => !hostAllowed(context.object_ref, policy.allowed_targets || []),
    description: 'Target not in policy allowlist',
  });

  deliveryPolicy.addRule({
    id: 'deny-missing-secret',
    action: 'deny',
    priority: 140,
    condition: (_context: any) => policy.require_hmac && !process.env.WEBHOOK_SIGNING_SECRET,
    description: 'Signing secret required',
  });

  const policyDecision = deliveryPolicy.evaluate({
    subject_ref: 'ocp.delivery',
    object_ref: request.target_url,
    verb: 'ocp.delivery.v1',
    timestamp: new Date(),
    input: request,
    metadata: { allow_real_send: policy.allow_real_send === true, policy_profile_id: profileId },
  });

  if (!policyDecision.allowed) {
    throw new Error(
      `Delivery denied by policy: ${policyDecision.reason || 'not allowed'} (${profileId})`
    );
  }

  const requestId = request.request_id ?? `req_${randomUUID()}`;
  const runId = `run_${randomUUID()}`;
  const evidenceDir = path.join('artifacts', 'ocp_delivery_v1', requestId, 'runs', runId);
  await fs.ensureDir(evidenceDir);
  const evidenceWriter = new EvidenceWriter();
  const payload = request.payload ?? {};
  const bodyHash = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  const targetHost = new URL(request.target_url).hostname;

  const idemStore = new IdempotencyStoreV0();
  await idemStore.init();

  const idemKey = request.idempotency_key;
  const requireIdem = process.env.OCP_REQUIRE_IDEMPOTENCY === '1';
  const suppressionEnabled = idemKey && idemKey.length > 0;
  const attempts: RetryAttemptLog[] = [];
  let outcomeCode = 'DELIVERED';

  if (suppressionEnabled) {
    const existing = idemStore.get(idemKey as string);
    if (existing) {
      if (existing.payload_sha256 === bodyHash) {
        const suppressedResultCore = {
          request_id: requestId,
          run_id: runId,
          driver_kind: 'http_webhook_delivery_v1',
          target_url: request.target_url,
          delivered: false,
          status_code: IDEMPOTENCY_ERRORS.SUPPRESSED_DUPLICATE,
          dry_run: false as const,
          original_evidence_path: existing.first_evidence_path,
        } as any;

        await evidenceWriter.writeArtifact(evidenceDir, 'request.json', {
          ...request,
          target_url: request.target_url,
          payload,
          metadata: request.metadata,
        });
        await evidenceWriter.writeArtifact(evidenceDir, 'result_core.json', suppressedResultCore);
        await evidenceWriter.writeArtifact(evidenceDir, 'evidence.json', {
          policy_profile_id: profileId,
          policy_allowed: policyDecision.allowed,
          policy_reason: policyDecision.reason,
          target_host: targetHost,
          request_body_sha256: bodyHash,
          suppressed: true,
          original_evidence_path: existing.first_evidence_path,
          timestamp: new Date().toISOString(),
          attempts: [],
          attempts_total: 0,
          outcome_code: 'SUPPRESSED_DUPLICATE',
        });

        return {
          result_core: suppressedResultCore,
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
      } else {
        throw new Error(IDEMPOTENCY_ERRORS.IDEMPOTENCY_CONFLICT);
      }
    }
  } else if (requireIdem) {
    throw new Error(IDEMPOTENCY_ERRORS.MISSING_IDEMPOTENCY_KEY);
  }

  const driver = getDriver('http_webhook_delivery_v1');

  const driverInput: WebhookDeliveryInputV1 = {
    target_url: request.target_url,
    payload,
    signing_secret: signingSecret || '',
    timeout_ms: policy.timeout_ms || 5000,
  };

  let driverResult: WebhookDeliveryOutputV1 | undefined;
  if (policy.retry_enabled) {
    const retryOutcome = await runWithRetry(
      () =>
        driver.execute(driverInput, {
          driverName: 'http_webhook_delivery_v1',
        }) as Promise<WebhookDeliveryOutputV1>,
      {
        retry_enabled: policy.retry_enabled,
        max_attempts: policy.max_attempts,
        retry_on_status: policy.retry_on_status,
        base_backoff_ms: policy.base_backoff_ms,
        max_backoff_ms: policy.max_backoff_ms,
      }
    );
    attempts.push(...retryOutcome.attempts);
    outcomeCode = retryOutcome.outcome_code;
    driverResult = retryOutcome.result;
  } else {
    driverResult = (await driver.execute(driverInput, {
      driverName: 'http_webhook_delivery_v1',
    })) as WebhookDeliveryOutputV1;
    const deliveredSingle =
      typeof driverResult.status === 'number' &&
      driverResult.status >= 200 &&
      driverResult.status < 300;
    attempts.push({
      attempt: 1,
      status: deliveredSingle ? 'DELIVERED' : 'NON_RETRYABLE_FAIL',
      http_status: driverResult.status,
      planned_backoff_ms: 0,
    });
    outcomeCode = deliveredSingle ? 'DELIVERED' : 'NON_RETRYABLE_HTTP_STATUS';
  }

  const delivered =
    driverResult !== undefined &&
    typeof driverResult.status === 'number' &&
    driverResult.status >= 200 &&
    driverResult.status < 300;

  const resultCore = {
    request_id: requestId,
    run_id: runId,
    driver_kind: 'http_webhook_delivery_v1',
    target_url: request.target_url,
    delivered,
    status_code: driverResult?.status,
    dry_run: false as const,
  };

  await evidenceWriter.writeArtifact(evidenceDir, 'request.json', {
    ...request,
    target_url: request.target_url,
    payload,
    metadata: request.metadata,
  });
  await evidenceWriter.writeArtifact(evidenceDir, 'result_core.json', resultCore);
  await evidenceWriter.writeArtifact(evidenceDir, 'evidence.json', {
    policy_profile_id: profileId,
    policy_allowed: policyDecision.allowed,
    policy_reason: policyDecision.reason,
    target_host: targetHost,
    request_body_sha256: bodyHash,
    response_status: driverResult?.status,
    response_body_sha256: driverResult?.response_body_sha256,
    duration_ms: driverResult?.duration_ms,
    timestamp: new Date().toISOString(),
    suppressed: false,
    attempts,
    attempts_total: attempts.length,
    outcome_code: outcomeCode,
  });

  // Record idempotency entry for future suppression
  await idemStore.record(
    request.idempotency_key as string,
    bodyHash,
    path.join(evidenceDir, 'evidence.json'),
    Date.now()
  );

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
