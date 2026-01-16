import fs from 'fs-extra';
import path from 'path';
import http from 'http';
import { createHash, createHmac } from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { runOcpDeliveryV1 } = require('../build/src/ocp/delivery_v1.js');
const { redactObject } = require('../build/src/evidence/redact_v0.js');

const SECRET = 'test_secret_v1';
const PROFILE_ID = 'ocp_delivery_dev_local_throttle_v0';

function verifyRequest(req, body) {
  const ts = req.headers['x-mova-ts'];
  const bodySha = req.headers['x-mova-body-sha256'];
  const sig = req.headers['x-mova-sig'];
  if (!ts || !bodySha || !sig) return false;
  const computedBodySha = createHash('sha256').update(body, 'utf8').digest('hex');
  if (computedBodySha !== bodySha) return false;
  const expectedSig = createHmac('sha256', SECRET).update(`${ts}.${bodySha}`, 'utf8').digest('hex');
  return expectedSig === sig;
}

function startMockServer() {
  let callCount = 0;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
    });
    req.on('end', () => {
      if (!verifyRequest(req, data)) {
        res.statusCode = 401;
        res.end('unauthorized');
        return;
      }
      callCount += 1;
      res.statusCode = 200;
      res.end('ok');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, getCallCount: () => callCount });
    });
  });
}

async function loadFixture(relPath, targetUrl) {
  const fixturePath = path.join(__dirname, '..', relPath);
  const raw = await fs.readJson(fixturePath);
  return JSON.parse(JSON.stringify(raw).replace('{{WEBHOOK_URL}}', targetUrl));
}

async function main() {
  const { server, port, getCallCount } = await startMockServer();
  const targetUrl = `http://127.0.0.1:${port}/hook`;

  try {
    process.env.OCP_ENABLE_REAL_SEND = '1';
    process.env.WEBHOOK_SIGNING_SECRET = SECRET;
    process.env.OCP_POLICY_PROFILE_ID = PROFILE_ID;
    process.env.OCP_RATE_LIMIT_STRICT_OVERRIDE = '1';

    const runRoot = path.join(
      'artifacts',
      'quality',
      'ocp_rate_limit_throttle_v0',
      'neg',
      `run_${Date.now()}`
    );
    const rateLimitStorePath = path.join(runRoot, 'rate_limit_store.json');
    const idemStorePath = path.join(runRoot, 'idempotency_store.json');
    process.env.OCP_RATE_LIMIT_STORE_PATH = rateLimitStorePath;
    process.env.OCP_IDEMPOTENCY_STORE_PATH = idemStorePath;
    if (await fs.pathExists(rateLimitStorePath)) {
      await fs.remove(rateLimitStorePath);
    }
    if (await fs.pathExists(idemStorePath)) {
      await fs.remove(idemStorePath);
    }

    const fixture = await loadFixture(
      'packs/ocp_rate_limit_throttle_v0/fixtures/neg/two_sends_strict_throttle.json',
      targetUrl
    );

    const firstResult = await runOcpDeliveryV1(fixture);
    const secondResult = await runOcpDeliveryV1(fixture);
    const secondEvidence = await fs.readJson(secondResult.evidence.artifacts.evidence);

    const assertions = [
      { name: 'first_delivered', passed: firstResult.result_core.delivered === true },
      { name: 'second_throttled_strict', passed: secondEvidence.outcome_code === 'THROTTLED_STRICT' },
      { name: 'call_count_one', passed: getCallCount() === 1 },
    ];

    const allPassed = assertions.every((a) => a.passed);

    const reportDir = path.join(
      'artifacts',
      'quality',
      'ocp_rate_limit_throttle_v0',
      'neg',
      firstResult.evidence.request_id,
      'runs',
      firstResult.evidence.run_id
    );
    await fs.ensureDir(reportDir);

    const report = redactObject({
      status: allPassed ? 'passed' : 'failed',
      assertions,
      first_result: firstResult.result_core,
      second_result: secondResult.result_core,
      call_count: getCallCount(),
      policy_profile_id: PROFILE_ID,
      env: {
        OCP_RATE_LIMIT_STORE_PATH: process.env.OCP_RATE_LIMIT_STORE_PATH ? 'set' : 'missing',
        OCP_RATE_LIMIT_STRICT_OVERRIDE: process.env.OCP_RATE_LIMIT_STRICT_OVERRIDE ? 'set' : 'missing',
        WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET
          ? `len=${process.env.WEBHOOK_SIGNING_SECRET.length}`
          : 'missing',
      },
    });

    await fs.writeJson(path.join(reportDir, 'neg_report.json'), report, { spaces: 2 });

    if (!allPassed) {
      console.error('[quality:ocp_rate_limit_throttle:neg] FAIL', reportDir);
      process.exit(1);
    }
    console.log('[quality:ocp_rate_limit_throttle:neg] PASS', reportDir);
  } catch (error) {
    console.error('[quality:ocp_rate_limit_throttle:neg] FAIL', error.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error('[quality:ocp_rate_limit_throttle:neg] FAIL', error.message);
  process.exit(1);
});
