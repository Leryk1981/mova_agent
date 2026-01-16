import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function redactReport(report) {
  return redactValue(report);
}

function envPresence(name) {
  const v = process.env[name];
  return v ? `len=${v.length}` : 'missing';
}

function loadPolicy(profileId) {
  const policyPath = path.join(__dirname, '../policies/ocp_delivery', `${profileId}.json`);
  if (!fs.existsSync(policyPath)) {
    return { ok: false, code: 'POLICY_PROFILE_NOT_FOUND', policy: null, path: policyPath };
  }
  const policy = fs.readJsonSync(policyPath);
  return { ok: true, policy, path: policyPath };
}

function checkAllowlist(policy, urlString) {
  if (!urlString) return { ok: false, code: 'MISSING_STAGING_ENV' };
  try {
    const host = new URL(urlString).hostname;
    const allowed = policy.allowed_targets || [];
    return allowed.includes(host)
      ? { ok: true }
      : { ok: false, code: 'STAGING_URL_NOT_IN_ALLOWLIST', host };
  } catch {
    return { ok: false, code: 'STAGING_URL_NOT_IN_ALLOWLIST' };
  }
}

async function writeReport(report) {
  const runId = `run_${Date.now()}`;
  const reportPath = path.join('artifacts', 'doctor', 'ocp_delivery', runId, 'doctor_report.json');
  await fs.ensureDir(path.dirname(reportPath));
  await fs.writeJson(reportPath, redactReport({ run_id: runId, ...report }), { spaces: 2 });
  return reportPath;
}

async function main() {
  const strict = process.argv.includes('--strict');
  const profileId = process.env.OCP_POLICY_PROFILE_ID || 'ocp_delivery_dev_local_v0';
  const checks = [];
  const actions = [];
  let status = 'PASS';

  const envSummary = {
    OCP_POLICY_PROFILE_ID: profileId,
    OCP_ENABLE_REAL_SEND: envPresence('OCP_ENABLE_REAL_SEND'),
    OCP_STAGING_WEBHOOK_URL: envPresence('OCP_STAGING_WEBHOOK_URL'),
    OCP_STAGING_SIGNING_SECRET: envPresence('OCP_STAGING_SIGNING_SECRET'),
    WEBHOOK_SIGNING_SECRET: envPresence('WEBHOOK_SIGNING_SECRET'),
    OCP_IDEMPOTENCY_STORE_PATH: envPresence('OCP_IDEMPOTENCY_STORE_PATH'),
  };

  const policyLoad = loadPolicy(profileId);
  if (!policyLoad.ok) {
    checks.push({ name: 'policy_loaded', status: 'FAIL', code: policyLoad.code });
    status = 'FAIL';
  } else {
    checks.push({ name: 'policy_loaded', status: 'PASS' });
    const policy = policyLoad.policy;

    if (process.env.OCP_ENABLE_REAL_SEND === '1' && policy.allow_real_send !== true) {
      checks.push({ name: 'real_send_policy', status: 'FAIL', code: 'REAL_SEND_ARMED_BUT_POLICY_DENIES' });
      status = 'FAIL';
      actions.push('Disable OCP_ENABLE_REAL_SEND or enable allow_real_send in policy');
    } else {
      checks.push({ name: 'real_send_policy', status: 'PASS' });
    }

    if (process.env.OCP_STAGING_WEBHOOK_URL) {
      const allow = checkAllowlist(policy, process.env.OCP_STAGING_WEBHOOK_URL);
      if (!allow.ok) {
        checks.push({ name: 'staging_allowlist', status: 'FAIL', code: allow.code });
        status = 'FAIL';
        actions.push('Add staging host to policy allowlist or update env URL');
      } else {
        checks.push({ name: 'staging_allowlist', status: 'PASS' });
      }
    } else {
      checks.push({ name: 'staging_env', status: 'WARN', code: 'MISSING_STAGING_ENV' });
      if (status === 'PASS') status = 'WARN';
    }
  }

  const report = {
    status,
    policy_profile_id: profileId,
    env: envSummary,
    checks,
    recommended_actions: actions,
  };

  const reportPath = await writeReport(report);
  console.log(`[ocp:doctor] ${status}`, reportPath);
  if (strict && status === 'FAIL') {
    process.exit(1);
  }
}

main().catch(async (error) => {
  const reportPath = await writeReport({
    status: 'FAIL',
    error: error.message,
    checks: [{ name: 'doctor_error', status: 'FAIL', code: error.message }],
  });
  console.error('[ocp:doctor] FAIL', reportPath);
  process.exit(1);
});
