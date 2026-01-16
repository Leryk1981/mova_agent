import fs from 'fs-extra';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runOcpDeliveryV1 } = require('../build/src/ocp/delivery_v1.js');

function runStep(name, cmd, args, extraEnv = {}) {
  console.log(`[evidence-hygiene:neg] step ${name} -> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: true,
  });
  const code = typeof res.status === 'number' ? res.status : -1;
  const status = code === 0 ? 'passed' : 'failed';
  if (res.error) {
    console.error(`[evidence-hygiene:neg] step ${name} error: ${res.error.message}`);
  }
  return { name, status, code };
}

async function runFixtureWithSecrets(baseDir) {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  const listenPromise = new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  await listenPromise;
  const { port } = server.address();
  const targetUrl = `http://127.0.0.1:${port}/hook?token=FAKE_TOKEN`;

  const fixturePath = path.join(
    __dirname,
    '../packs/ocp_evidence_hygiene_v0/fixtures/neg/secrets_in_input.json'
  );
  const raw = await fs.readJson(fixturePath);
  const request = { ...raw, target_url: targetUrl };
  const storePath = path.join(baseDir, `store_${Date.now()}.json`);

  process.env.OCP_ENABLE_REAL_SEND = '1';
  process.env.WEBHOOK_SIGNING_SECRET = 'test_secret_v1';
  process.env.OCP_POLICY_PROFILE_ID = 'ocp_delivery_dev_local_v0';
  process.env.OCP_IDEMPOTENCY_STORE_PATH = storePath;

  try {
    await runOcpDeliveryV1(request);
    return { name: 'delivery_fixture_with_secrets', status: 'passed' };
  } catch (error) {
    return { name: 'delivery_fixture_with_secrets', status: 'failed', error: error.message };
  } finally {
    server.close();
  }
}

async function main() {
  const runId = `run_${Date.now()}`;
  const baseDir = path.join('artifacts', 'quality', 'ocp_evidence_hygiene_v0', 'neg', runId);
  await fs.ensureDir(baseDir);

  const envSecrets = {
    OCP_STAGING_SIGNING_SECRET: 'test_secret_v1',
    WEBHOOK_SIGNING_SECRET: 'test_secret_v1',
  };

  const steps = [];
  steps.push(runStep('build', 'npm', ['run', 'build']));
  steps.push(runStep('ocp:doctor', 'npm', ['run', 'ocp:doctor'], envSecrets));
  steps.push(runStep('smoke:ocp_delivery:staging', 'npm', ['run', 'smoke:ocp_delivery:staging'], envSecrets));
  steps.push(runStep('quality:ocp_delivery_v1:neg', 'npm', ['run', 'quality:ocp_delivery_v1:neg'], envSecrets));
  steps.push(await runFixtureWithSecrets(baseDir));

  const scanRunId = `ocp_evidence_hygiene_neg_${runId}`;
  const scanRes = runStep('secret_scan', 'node', [
    path.join(__dirname, 'artifact_secret_scan_v0.mjs'),
    '--dir',
    path.join('artifacts', 'quality'),
    '--run-id',
    scanRunId,
  ]);

  const allPassed = steps.every((s) => s.status === 'passed') && scanRes.status === 'passed';
  const report = {
    status: allPassed ? 'passed' : 'failed',
    run_id: runId,
    steps,
    scan_run_id: scanRunId,
    scan_status: scanRes.status,
    scan_report: path.join('artifacts', 'quality', scanRunId, 'secret_scan_report.json'),
  };

  await fs.writeJson(path.join(baseDir, 'neg_report.json'), report, { spaces: 2 });
  console.log(`[quality:ocp_evidence_hygiene_v0:neg] ${report.status.toUpperCase()}`, baseDir);
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error('[quality:ocp_evidence_hygiene_v0:neg] FAIL', err.message);
  process.exit(1);
});
