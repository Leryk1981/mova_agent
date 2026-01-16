import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runOcpDeliveryV0 } = require('../build/src/ocp/delivery_v0.js');

async function loadFixture(relativePath) {
  const fixturePath = path.join(__dirname, '../packs/ocp_delivery_v0', relativePath);
  return fs.readJson(fixturePath);
}

async function runScenario(name, request, envFlag) {
  process.env.ALLOW_NOOP_ONLY = envFlag;
  try {
    const result = await runOcpDeliveryV0(request);
    if (name === 'secret_leak') {
      const evidenceDir = result.evidence.evidence_dir;
      const files = await fs.readdir(evidenceDir);
      const content = await Promise.all(
        files.map((f) => fs.readFile(path.join(evidenceDir, f), 'utf8'))
      );
      const blob = content.join('\n');
      const secretMarkers = ['VERY_SECRET_TOKEN_123', 'SHOULD_NOT_LEAK', 'Bearer SECRET123'];
      const leaked = secretMarkers.some((s) => blob.includes(s));
      return {
        name,
        passed: !leaked,
        error: leaked ? 'secret found in artifacts' : 'secrets redacted',
      };
    }
    return { name, passed: false, error: 'expected failure but delivery succeeded' };
  } catch (error) {
    return { name, passed: true, error: error.message };
  }
}

async function main() {
  const scenarios = [
    {
      name: 'deny_without_flag',
      request: await loadFixture('fixtures/pos/noop_delivery_request.json'),
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
    {
      name: 'secret_leak',
      request: await loadFixture('fixtures/neg/secret_leak.json'),
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
    'ocp_delivery_v0',
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
    console.error('[quality:ocp_delivery:neg] FAIL', reportDir);
    process.exit(1);
  }

  console.log('[quality:ocp_delivery:neg] PASS', reportDir);
}

main().catch((error) => {
  console.error('[quality:ocp_delivery:neg] FAIL', error.message);
  process.exit(1);
});
