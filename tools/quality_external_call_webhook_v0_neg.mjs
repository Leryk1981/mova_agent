import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runExternalCallWebhookV0 } = require('../build/src/ocp/external_call_webhook_v0.js');

async function loadFixture(relativePath) {
  const fixturePath = path.join(__dirname, '../packs/external_call_webhook_v0', relativePath);
  return fs.readJson(fixturePath);
}

async function runScenario(name, request, envFlag) {
  process.env.ALLOW_NOOP_ONLY = envFlag;
  try {
    await runExternalCallWebhookV0(request);
    return { name, passed: false, error: 'expected failure but webhook succeeded' };
  } catch (error) {
    return { name, passed: true, error: error.message };
  }
}

async function main() {
  const scenarios = [
    {
      name: 'deny_without_flag',
      request: await loadFixture('fixtures/pos/webhook_noop_request.json'),
      flag: '',
    },
    {
      name: 'forbidden_target',
      request: await loadFixture('fixtures/neg/forbidden_target.json'),
      flag: 'true',
    },
    {
      name: 'oversize_payload',
      request: await loadFixture('fixtures/neg/oversize_payload.json'),
      flag: 'true',
    },
    {
      name: 'missing_target',
      request: await loadFixture('fixtures/neg/missing_target.json'),
      flag: 'true',
    },
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario.name, scenario.request, scenario.flag));
  }

  const allPassed = results.every((r) => r.passed);

  const requestId = `req_quality_neg_${Date.now()}`;
  const runId = `run_quality_neg_${Date.now()}`;
  const reportDir = path.join(
    'artifacts',
    'quality',
    'external_call_webhook_v0',
    'neg',
    requestId,
    'runs',
    runId
  );
  await fs.ensureDir(reportDir);

  const report = {
    request_id: requestId,
    run_id: runId,
    status: allPassed ? 'passed' : 'failed',
    scenarios: results,
  };

  await fs.writeJson(path.join(reportDir, 'report.json'), report, { spaces: 2 });

  if (!allPassed) {
    console.error('[quality:external_call_webhook:neg] FAIL', reportDir);
    process.exit(1);
  }

  console.log('[quality:external_call_webhook:neg] PASS', reportDir);
}

main().catch((error) => {
  console.error('[quality:external_call_webhook:neg] FAIL', error.message);
  process.exit(1);
});
