import fs from 'fs-extra';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runOcpDeliveryV1 } = require('../build/src/ocp/delivery_v1.js');

const PROFILE_ID = 'ocp_delivery_dev_local_v0';

function startMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function loadFixture(relPath, targetUrl) {
  const fixturePath = path.join(__dirname, '../packs/ocp_delivery_v1', relPath);
  const raw = await fs.readJson(fixturePath);
  return JSON.parse(JSON.stringify(raw).replace('{{WEBHOOK_URL}}', targetUrl));
}

async function runScenario(name, requestBuilder, env) {
  process.env.OCP_ENABLE_REAL_SEND = env.enable ?? '';
  process.env.WEBHOOK_SIGNING_SECRET = env.secret ?? '';
  process.env.OCP_POLICY_PROFILE_ID = env.profile ?? PROFILE_ID;
  process.env.OCP_IDEMPOTENCY_STORE_PATH = env.storePath || '';
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
  const localUrl = `http://127.0.0.1:${port}/hook`;

  try {
    const storePath = path.join(
      'artifacts',
      'quality',
      'ocp_delivery_v1',
      'neg',
      `store_${Date.now()}_v1_neg.json`
    );
    if (await fs.pathExists(storePath)) {
      await fs.remove(storePath);
    }

    const scenarios = [
      {
        name: 'missing_secret',
        env: { enable: '1', secret: '', profile: PROFILE_ID, storePath },
        requestBuilder: async () => loadFixture('fixtures/neg/missing_secret.json', localUrl),
      },
      {
        name: 'forbidden_target',
        env: { enable: '1', secret: 'test_secret_v1', profile: PROFILE_ID, storePath },
        requestBuilder: async () => loadFixture('fixtures/neg/forbidden_target.json', localUrl),
      },
      {
        name: 'oversize_payload',
        env: { enable: '1', secret: 'test_secret_v1', profile: PROFILE_ID, storePath },
        requestBuilder: async () => loadFixture('fixtures/neg/oversize_payload.json', localUrl),
      },
      {
        name: 'deny_non_local_even_with_profile',
        env: { enable: '1', secret: 'test_secret_v1', profile: PROFILE_ID, storePath },
        requestBuilder: async () =>
          loadFixture('fixtures/neg/forbidden_target.json', 'https://example.org/hook'),
      },
    ];

    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario.name, scenario.requestBuilder, scenario.env));
    }

    const allPassed = results.every((r) => r.passed);
    const requestId = `req_quality_neg_${Date.now()}`;
    const runId = `run_quality_neg_${Date.now()}`;
    const reportDir = path.join(
      'artifacts',
      'quality',
      'ocp_delivery_v1',
      'neg',
      requestId,
      'runs',
      runId
    );
    await fs.ensureDir(reportDir);

    const report = {
      status: allPassed ? 'passed' : 'failed',
      request_id: requestId,
      run_id: runId,
      scenarios: results,
      policy_profile_id: PROFILE_ID,
    };

    await fs.writeJson(path.join(reportDir, 'neg_report.json'), report, { spaces: 2 });

    if (!allPassed) {
      console.error('[quality:ocp_delivery_v1:neg] FAIL', reportDir);
      process.exit(1);
    }

    console.log('[quality:ocp_delivery_v1:neg] PASS', reportDir);
  } catch (error) {
    console.error('[quality:ocp_delivery_v1:neg] FAIL', error.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error('[quality:ocp_delivery_v1:neg] FAIL', error.message);
  process.exit(1);
});
