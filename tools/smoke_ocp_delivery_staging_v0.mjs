import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runOcpDeliveryV1 } = require('../build/src/ocp/delivery_v1.js');
const SENSITIVE_KEYS = ['token', 'secret', 'key', 'auth', 'password', 'authorization'];

function maskString(value) {
  const hash = createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
  return `***REDACTED:${hash}***`;
}

function redactValue(value, keyHint) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  if (typeof value === 'string') {
    const lowerKey = (keyHint || '').toLowerCase();
    const lowerVal = value.toLowerCase();
    if (SENSITIVE_KEYS.some((m) => lowerKey.includes(m) || lowerVal.includes(m))) {
      return maskString(value);
    }
  }
  return value;
}

function buildEvidencePath(runId) {
  return path.join('artifacts', 'smoke', 'ocp_delivery_staging', runId, 'smoke_evidence.json');
}

async function writeEvidence(runId, data) {
  const evidencePath = buildEvidencePath(runId);
  await fs.ensureDir(path.dirname(evidencePath));
  await fs.writeJson(evidencePath, redactValue({ run_id: runId, ...data }), { spaces: 2 });
  return evidencePath;
}

async function main() {
  const webhookUrl = process.env.OCP_STAGING_WEBHOOK_URL || '';
  const signingSecret = process.env.OCP_STAGING_SIGNING_SECRET || '';
  const runId = `run_${Date.now()}`;

  if (!webhookUrl || !signingSecret) {
    const evidencePath = await writeEvidence(runId, {
      status: 'SKIP',
      reason: 'Missing required env vars',
      env_present: {
        OCP_STAGING_WEBHOOK_URL: Boolean(webhookUrl),
        OCP_STAGING_SIGNING_SECRET: signingSecret ? `len=${signingSecret.length}` : 'missing',
      },
    });
    console.log('[smoke:ocp_delivery:staging] SKIP', evidencePath);
    return;
  }

  process.env.OCP_POLICY_PROFILE_ID = 'ocp_delivery_staging_v0';
  process.env.OCP_ENABLE_REAL_SEND = '1';
  process.env.WEBHOOK_SIGNING_SECRET = signingSecret;

  const request = {
    target_url: webhookUrl,
    payload: { smoke: 'ocp_delivery_staging_v0' },
    metadata: { smoke: true },
  };

  const evidence = {
    status: 'UNKNOWN',
    policy_profile_id: process.env.OCP_POLICY_PROFILE_ID,
  };

  try {
    const result = await runOcpDeliveryV1(request);
    const respSha = result.result_core?.status_code
      ? createHash('sha256').update(JSON.stringify(result.result_core), 'utf8').digest('hex')
      : undefined;

    evidence.status = result.result_core.delivered ? 'PASS' : 'FAIL';
    evidence.request_id = result.evidence.request_id;
    evidence.target_host = new URL(request.target_url).hostname;
    evidence.http_status = result.result_core.status_code;
    evidence.response_body_sha256 = respSha;
    evidence.evidence_artifacts = result.evidence.artifacts;
    evidence.policy_profile_id = process.env.OCP_POLICY_PROFILE_ID;

    const evidencePath = await writeEvidence(runId, evidence);
    if (evidence.status !== 'PASS') {
      console.error('[smoke:ocp_delivery:staging] FAIL', evidencePath);
      process.exit(1);
    }
    console.log('[smoke:ocp_delivery:staging] PASS', evidencePath);
  } catch (error) {
    evidence.status = 'FAIL';
    evidence.error = error.message;
    const evidencePath = await writeEvidence(runId, evidence);
    console.error('[smoke:ocp_delivery:staging] FAIL', evidencePath);
    process.exit(1);
  }
}

main().catch(async (error) => {
  const runId = `run_${Date.now()}`;
  const evidencePath = await writeEvidence(runId, {
    status: 'FAIL',
    error: error.message,
  });
  console.error('[smoke:ocp_delivery:staging] FAIL', evidencePath);
  process.exit(1);
});
