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

const SECRET = 'test_secret_v1';
const PROFILE_ID = 'ocp_delivery_dev_local_retry_v0';

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
  let flakyCount = 0;
  let timeoutCount = 0;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
    });
    req.on('end', () => {
      const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (!verifyRequest(req, data)) {
        res.statusCode = 401;
        res.end('unauthorized');
        return;
      }

      if (urlPath === '/flaky2') {
        flakyCount += 1;
        if (flakyCount <= 2) {
          res.statusCode = 500;
          res.end('flaky');
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, attempt: flakyCount }));
        return;
      }

      if (urlPath === '/timeout1') {
        timeoutCount += 1;
        if (timeoutCount === 1) {
          setTimeout(() => {
            res.statusCode = 504;
            res.end('timeout');
          }, 5000);
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, attempt: timeoutCount }));
        return;
      }

      res.statusCode = 404;
      res.end('not-found');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function loadFixture(relativePath) {
  const fixturePath = path.join(__dirname, relativePath);
  return fs.readJson(fixturePath);
}

async function runScenario(fixtureRelPath, targetUrl) {
  const fixture = await loadFixture(fixtureRelPath);
  const request = JSON.parse(JSON.stringify(fixture).replace('{{WEBHOOK_URL}}', targetUrl));
  const storeRoot = path.join(
    'artifacts',
    'quality',
    'ocp_retry_backoff_v0',
    'pos',
    fixture.metadata?.trace_id || `fixture_${Date.now()}`,
    'runs',
    `run_${Date.now()}`
  );
  const storePath = path.join(storeRoot, 'idempotency_store.json');
  if (await fs.pathExists(storePath)) {
    await fs.remove(storePath);
  }
  process.env.OCP_IDEMPOTENCY_STORE_PATH = storePath;

  const result = await runOcpDeliveryV1(request);
  const evidence = await fs.readJson(result.evidence.artifacts.evidence);

  const reportDir = path.join(
    'artifacts',
    'quality',
    'ocp_retry_backoff_v0',
    'pos',
    result.evidence.request_id,
    'runs',
    result.evidence.run_id
  );
  await fs.ensureDir(reportDir);

  return { result, evidence, reportDir };
}

async function main() {
  const { server, port } = await startMockServer();
  const targetBase = `http://127.0.0.1:${port}`;

  try {
    process.env.OCP_ENABLE_REAL_SEND = '1';
    process.env.WEBHOOK_SIGNING_SECRET = SECRET;
    process.env.OCP_POLICY_PROFILE_ID = PROFILE_ID;

    const flaky = await runScenario(
      '../packs/ocp_retry_backoff_v0/fixtures/pos/flaky_2_then_ok.json',
      `${targetBase}`
    );
    const timeout = await runScenario(
      '../packs/ocp_retry_backoff_v0/fixtures/pos/timeout_then_ok.json',
      `${targetBase}`
    );

    const assertions = [
      {
        name: 'flaky_delivered',
        passed: flaky.result.result_core.delivered === true,
      },
      {
        name: 'flaky_attempts_total',
        passed: flaky.evidence.attempts_total === 3,
        expected: 3,
        actual: flaky.evidence.attempts_total,
      },
      {
        name: 'timeout_delivered',
        passed: timeout.result.result_core.delivered === true,
      },
      {
        name: 'timeout_attempts_total',
        passed: timeout.evidence.attempts_total === 2,
        expected: 2,
        actual: timeout.evidence.attempts_total,
      },
    ];

    const allPassed = assertions.every((a) => a.passed);

    const finalReportDir = path.join(
      'artifacts',
      'quality',
      'ocp_retry_backoff_v0',
      'pos',
      flaky.result.evidence.request_id,
      'runs',
      flaky.result.evidence.run_id
    );
    await fs.ensureDir(finalReportDir);

    const report = {
      status: allPassed ? 'passed' : 'failed',
      policy_profile_id: PROFILE_ID,
      flaky: {
        result_core: flaky.result.result_core,
        evidence_path: flaky.result.evidence.artifacts.evidence,
      },
      timeout: {
        result_core: timeout.result.result_core,
        evidence_path: timeout.result.evidence.artifacts.evidence,
      },
      assertions,
    };

    await fs.writeJson(path.join(finalReportDir, 'pos_report.json'), report, { spaces: 2 });

    if (!allPassed) {
      console.error('[quality:ocp_retry_backoff_v0] FAIL', finalReportDir);
      process.exit(1);
    }
    console.log('[quality:ocp_retry_backoff_v0] PASS', finalReportDir);
  } catch (error) {
    console.error('[quality:ocp_retry_backoff_v0] FAIL', error.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error('[quality:ocp_retry_backoff_v0] FAIL', error.message);
  process.exit(1);
});
