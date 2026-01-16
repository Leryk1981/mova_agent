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
  let callCount = 0;
  const server = http.createServer((_req, res) => {
    callCount += 1;
    res.statusCode = 200;
    res.end('ok');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, getCallCount: () => callCount });
    });
  });
}

async function main() {
  const { server, port, getCallCount } = await startMockServer();
  const targetUrl = `http://127.0.0.1:${port}/hook`;
  try {
    process.env.OCP_ENABLE_REAL_SEND = '1';
    process.env.WEBHOOK_SIGNING_SECRET = 'test_secret_v1';
    process.env.OCP_POLICY_PROFILE_ID = 'ocp_delivery_dev_local_v0';
    const storeDir = path.join(
      'artifacts',
      'quality',
      'ocp_idempotency_suppression_v0',
      'pos',
      `run_${Date.now()}`
    );
    const storePath = path.join(storeDir, 'store.json');
    if (await fs.pathExists(storePath)) {
      await fs.remove(storePath);
    }
    process.env.OCP_IDEMPOTENCY_STORE_PATH = storePath;

    const firstFixture = await fs.readJson(
      path.join(__dirname, '../packs/ocp_idempotency_suppression_v0/fixtures/pos/first_send.json')
    );
    const repeatFixture = await fs.readJson(
      path.join(
        __dirname,
        '../packs/ocp_idempotency_suppression_v0/fixtures/pos/repeat_same_key.json'
      )
    );

    const firstReq = { ...firstFixture, target_url: targetUrl };
    const repeatReq = { ...repeatFixture, target_url: targetUrl };

    const firstResult = await runOcpDeliveryV1(firstReq);
    const repeatResult = await runOcpDeliveryV1(repeatReq);

    const assertions = [
      { name: 'first_delivered', passed: firstResult.result_core.delivered === true },
      {
        name: 'repeat_suppressed',
        passed: repeatResult.result_core.status_code === 'SUPPRESSED_DUPLICATE',
      },
      { name: 'call_count_one', passed: getCallCount() === 1 },
    ];

    const allPassed = assertions.every((a) => a.passed);

    const reportDir = path.join(
      'artifacts',
      'quality',
      'ocp_idempotency_suppression_v0',
      'pos',
      firstResult.evidence.request_id,
      'runs',
      firstResult.evidence.run_id
    );
    await fs.ensureDir(reportDir);

    const report = redactObject({
      status: allPassed ? 'passed' : 'failed',
      assertions,
      first_result: firstResult.result_core,
      repeat_result: repeatResult.result_core,
      call_count: getCallCount(),
      env: {
        WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET
          ? `len=${process.env.WEBHOOK_SIGNING_SECRET.length}`
          : 'missing',
      },
    });

    await fs.writeJson(path.join(reportDir, 'pos_report.json'), report, { spaces: 2 });

    if (!allPassed) {
      console.error('[quality:ocp_idempotency_suppression] FAIL', reportDir);
      process.exit(1);
    }
    console.log('[quality:ocp_idempotency_suppression] PASS', reportDir);
  } catch (error) {
    console.error('[quality:ocp_idempotency_suppression] FAIL', error.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error('[quality:ocp_idempotency_suppression] FAIL', error.message);
  process.exit(1);
});
