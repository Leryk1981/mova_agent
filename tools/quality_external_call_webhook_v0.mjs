import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runExternalCallWebhookV0 } = require('../build/src/ocp/external_call_webhook_v0.js');

async function main() {
  process.env.ALLOW_NOOP_ONLY = process.env.ALLOW_NOOP_ONLY || 'true';

  const fixturePath = path.join(
    __dirname,
    '../packs/external_call_webhook_v0/fixtures/pos/webhook_noop_request.json'
  );
  const request = await fs.readJson(fixturePath);

  const result = await runExternalCallWebhookV0(request);

  const filesToCheck = Object.values(result.evidence.artifacts);
  const filesExist = await Promise.all(filesToCheck.map((file) => fs.pathExists(file)));

  const assertions = [
    { name: 'dry_run_enforced', passed: result.result_core.dry_run === true },
    { name: 'driver_kind', passed: result.result_core.driver_kind === 'noop_webhook_v0' },
    { name: 'delivered_false', passed: result.result_core.delivered === false },
    { name: 'evidence_dir_set', passed: Boolean(result.result_core.evidence_dir) },
    { name: 'artifacts_written', passed: filesExist.every(Boolean) },
  ];

  const reportDir = path.join(
    'artifacts',
    'quality',
    'external_call_webhook_v0',
    'pos',
    result.evidence.request_id,
    'runs',
    result.evidence.run_id
  );
  await fs.ensureDir(reportDir);

  const report = {
    request_id: result.evidence.request_id,
    run_id: result.evidence.run_id,
    status: assertions.every((a) => a.passed) ? 'passed' : 'failed',
    assertions,
    result_core: result.result_core,
    evidence: result.evidence,
    refs: [
      { type: 'request', path: result.evidence.artifacts.request },
      { type: 'result_core', path: result.evidence.artifacts.result_core },
      { type: 'driver_result', path: result.evidence.artifacts.driver_result },
    ],
  };

  await fs.writeJson(path.join(reportDir, 'report.json'), report, { spaces: 2 });

  if (report.status !== 'passed') {
    console.error('[quality:external_call_webhook] FAIL', reportDir);
    process.exit(1);
  }

  console.log('[quality:external_call_webhook] PASS', reportDir);
}

main().catch((error) => {
  console.error('[quality:external_call_webhook] FAIL', error.message);
  process.exit(1);
});
