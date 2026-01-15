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

      const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (urlPath === '/bad400') {
        res.statusCode = 400;
        res.end('bad request');
        return;
      }
      if (urlPath === '/always500') {
        res.statusCode = 500;
        res.end('internal');
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

async function runScenario(fixtureRelPath, targetUrl, label) {
  const fixture = await loadFixture(fixtureRelPath);
  const request = JSON.parse(JSON.stringify(fixture).replace('{{WEBHOOK_URL}}', targetUrl));
  const storeRoot = path.join(
    'artifacts',
    'quality',
    'ocp_retry_backoff_v0',
    'neg',
    label,
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
    'neg',
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

    const bad400 = await runScenario(
      '../packs/ocp_retry_backoff_v0/fixtures/neg/http_400_no_retry.json',
      `${targetBase}`,
      'http_400_no_retry'
    );
    const always500 = await runScenario(
      '../packs/ocp_retry_backoff_v0/fixtures/neg/retry_exhausted_500.json',
      `${targetBase}`,
      'retry_exhausted_500'
    );

    const assertions = [
      {
        name: '400_non_retryable_once',
        passed: bad400.evidence.attempts_total === 1,
        expected: 1,
        actual: bad400.evidence.attempts_total,
      },
      {
        name: '400_outcome_non_retryable',
        passed: bad400.evidence.outcome_code === 'NON_RETRYABLE_HTTP_STATUS',
        expected: 'NON_RETRYABLE_HTTP_STATUS',
        actual: bad400.evidence.outcome_code,
      },
      {
        name: 'always500_retry_exhausted',
        passed: always500.evidence.outcome_code === 'RETRY_EXHAUSTED',
        expected: 'RETRY_EXHAUSTED',
        actual: always500.evidence.outcome_code,
      },
      {
        name: 'always500_attempts',
        passed: always500.evidence.attempts_total === 3,
        expected: 3,
        actual: always500.evidence.attempts_total,
      },
    ];

    const allPassed = assertions.every((a) => a.passed);

    const finalReportDir = path.join(
      'artifacts',
      'quality',
      'ocp_retry_backoff_v0',
      'neg',
      bad400.result.evidence.request_id,
      'runs',
      bad400.result.evidence.run_id
    );
    await fs.ensureDir(finalReportDir);

    const report = {
      status: allPassed ? 'passed' : 'failed',
      policy_profile_id: PROFILE_ID,
      scenarios: {
        bad400: {
          result_core: bad400.result.result_core,
          evidence_path: bad400.result.evidence.artifacts.evidence,
        },
        always500: {
          result_core: always500.result.result_core,
          evidence_path: always500.result.evidence.artifacts.evidence,
        },
      },
      assertions,
    };

    await fs.writeJson(path.join(finalReportDir, 'neg_report.json'), report, { spaces: 2 });

    if (!allPassed) {
      console.error('[quality:ocp_retry_backoff_v0:neg] FAIL', finalReportDir);
      process.exit(1);
    }
    console.log('[quality:ocp_retry_backoff_v0:neg] PASS', finalReportDir);
  } catch (error) {
    console.error('[quality:ocp_retry_backoff_v0:neg] FAIL', error.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error('[quality:ocp_retry_backoff_v0:neg] FAIL', error.message);
  process.exit(1);
});
