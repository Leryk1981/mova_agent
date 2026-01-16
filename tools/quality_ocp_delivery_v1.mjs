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
const PROFILE_ID = 'ocp_delivery_dev_local_v0';

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
  return new Promise((resolve) => {
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
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function main() {
  const { server, port } = await startMockServer();
  const targetUrl = `http://127.0.0.1:${port}/hook`;

  try {
    process.env.OCP_ENABLE_REAL_SEND = '1';
    process.env.WEBHOOK_SIGNING_SECRET = SECRET;
    process.env.OCP_POLICY_PROFILE_ID = PROFILE_ID;
    const storePath = path.join(
      'artifacts',
      'ocp_idempotency_store_v0',
      `store_${Date.now()}_pos.json`
    );
    process.env.OCP_IDEMPOTENCY_STORE_PATH = storePath;
    if (await fs.pathExists(storePath)) {
      await fs.remove(storePath);
    }

    const fixturePath = path.join(
      __dirname,
      '../packs/ocp_delivery_v1/fixtures/pos/local_webhook_send_request.json'
    );
    const fixture = await fs.readJson(fixturePath);
    const request = JSON.parse(JSON.stringify(fixture).replace('{{WEBHOOK_URL}}', targetUrl));

    const result = await runOcpDeliveryV1(request);

    const reportDir = path.join(
      'artifacts',
      'quality',
      'ocp_delivery_v1',
      'pos',
      result.evidence.request_id,
      'runs',
      result.evidence.run_id
    );
    await fs.ensureDir(reportDir);

    const report = redactObject({
      status: 'passed',
      request_id: result.evidence.request_id,
      run_id: result.evidence.run_id,
      target_url: targetUrl,
      result_core: result.result_core,
      evidence: result.evidence,
      policy_profile_id: PROFILE_ID,
      env: {
        OCP_ENABLE_REAL_SEND: process.env.OCP_ENABLE_REAL_SEND ? 'set' : 'missing',
        WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET
          ? `len=${process.env.WEBHOOK_SIGNING_SECRET.length}`
          : 'missing',
      },
    });

    await fs.writeJson(path.join(reportDir, 'pos_report.json'), report, { spaces: 2 });
    await fs.writeFile(
      path.join(reportDir, 'pos_report.md'),
      `# OCP Delivery v1 POS\nstatus: ${report.status}\nrun_id: ${report.run_id}\nrequest_id: ${report.request_id}\ntarget: ${targetUrl}\npolicy: ${PROFILE_ID}\n`,
      'utf8'
    );

    console.log('[quality:ocp_delivery_v1] PASS', reportDir);
  } catch (error) {
    console.error('[quality:ocp_delivery_v1] FAIL', error.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error('[quality:ocp_delivery_v1] FAIL', error.message);
  process.exit(1);
});
