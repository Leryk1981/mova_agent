import fs from 'fs-extra';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runOcpDeliveryV1 } = require('../build/src/ocp/delivery_v1.js');
const { redactObject } = require('../build/src/evidence/redact_v0.js');

function startMockServer() {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function loadFixture(relPath, targetUrl) {
  const fixturePath = path.join(__dirname, '../packs/ocp_idempotency_suppression_v0', relPath);
  const raw = await fs.readJson(fixturePath);
  return { ...raw, target_url: raw.target_url.replace('http://127.0.0.1:0', targetUrl) };
}

async function runScenario(name, requestBuilder) {
  try {
    const req = await requestBuilder();
    await runOcpDeliveryV1(req);
    return { name, passed: false, error: 'expected failure but run succeeded' };
  } catch (error) {
    return { name, passed: true, error: error.message };
  }
}

async function main() {
  const { server, port } = await startMockServer();
  const targetUrl = `http://127.0.0.1:${port}/hook`;

  try {
    process.env.OCP_ENABLE_REAL_SEND = '1';
    process.env.WEBHOOK_SIGNING_SECRET = 'test_secret_v1';
    process.env.OCP_POLICY_PROFILE_ID = 'ocp_delivery_dev_local_v0';
    const storeDir = path.join(
      'artifacts',
      'quality',
      'ocp_idempotency_suppression_v0',
      'neg',
      `run_${Date.now()}`
    );
    const storePath = path.join(storeDir, 'store.json');
    if (await fs.pathExists(storePath)) {
      await fs.remove(storePath);
    }
    process.env.OCP_IDEMPOTENCY_STORE_PATH = storePath;
    process.env.OCP_REQUIRE_IDEMPOTENCY = '1';

    // Seed store with base payload to ensure conflicts are detected
    const base = await loadFixture('fixtures/pos/first_send.json', targetUrl);
    await runOcpDeliveryV1(base);

    const scenarios = [
      {
        name: 'missing_idempotency_key',
        builder: async () => loadFixture('fixtures/neg/missing_idempotency_key.json', targetUrl),
      },
      {
        name: 'conflict_same_key_different_payload',
        builder: async () =>
          loadFixture('fixtures/neg/conflict_same_key_different_payload.json', targetUrl),
      },
    ];

    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario.name, scenario.builder));
    }

    const allPassed = results.every((r) => r.passed);
    const requestId = `req_quality_neg_${Date.now()}`;
    const runId = `run_quality_neg_${Date.now()}`;
    const reportDir = path.join(
      'artifacts',
      'quality',
      'ocp_idempotency_suppression_v0',
      'neg',
      requestId,
      'runs',
      runId
    );
    await fs.ensureDir(reportDir);

    const report = redactObject({
      status: allPassed ? 'passed' : 'failed',
      request_id: requestId,
      run_id: runId,
      scenarios: results,
      env: {
        WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET
          ? `len=${process.env.WEBHOOK_SIGNING_SECRET.length}`
          : 'missing',
      },
    });

    await fs.writeJson(path.join(reportDir, 'neg_report.json'), report, { spaces: 2 });

    if (!allPassed) {
      console.error('[quality:ocp_idempotency_suppression:neg] FAIL', reportDir);
      process.exit(1);
    }

    console.log('[quality:ocp_idempotency_suppression:neg] PASS', reportDir);
  } catch (error) {
    console.error('[quality:ocp_idempotency_suppression:neg] FAIL', error.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error('[quality:ocp_idempotency_suppression:neg] FAIL', error.message);
  process.exit(1);
});
