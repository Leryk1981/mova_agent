import fs from 'fs-extra';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runStep(name, cmd, args, extraEnv = {}) {
  console.log(`[evidence-hygiene:pos] step ${name} -> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: true,
  });
  const code = typeof res.status === 'number' ? res.status : -1;
  const status = code === 0 ? 'passed' : 'failed';
  if (res.error) {
    console.error(`[evidence-hygiene:pos] step ${name} error: ${res.error.message}`);
  }
  return { name, status, code };
}

async function main() {
  const runId = `run_${Date.now()}`;
  const baseDir = path.join('artifacts', 'quality', 'ocp_evidence_hygiene_v0', 'pos', runId);
  await fs.ensureDir(baseDir);

  const steps = [];
  steps.push(runStep('build', 'npm', ['run', 'build']));
  steps.push(runStep('ocp:doctor', 'npm', ['run', 'ocp:doctor']));
  steps.push(runStep('smoke:ocp_delivery:staging', 'npm', ['run', 'smoke:ocp_delivery:staging']));
  steps.push(runStep('quality:ocp_delivery_v1', 'npm', ['run', 'quality:ocp_delivery_v1']));

  const scanRunId = `ocp_evidence_hygiene_pos_${runId}`;
  const scanRes = runStep('secret_scan', 'node', [
    path.join(__dirname, 'artifact_secret_scan_v0.mjs'),
    '--dir',
    path.join('artifacts', 'quality'),
    '--run-id',
    scanRunId,
  ]);

  const allPassed = steps.every((s) => s.status === 'passed') && scanRes.status === 'passed';
  const report = {
    status: allPassed ? 'passed' : 'failed',
    run_id: runId,
    steps,
    scan_run_id: scanRunId,
    scan_status: scanRes.status,
    scan_report: path.join('artifacts', 'quality', scanRunId, 'secret_scan_report.json'),
  };

  await fs.writeJson(path.join(baseDir, 'pos_report.json'), report, { spaces: 2 });
  console.log(`[quality:ocp_evidence_hygiene_v0] ${report.status.toUpperCase()}`, baseDir);
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error('[quality:ocp_evidence_hygiene_v0] FAIL', err.message);
  process.exit(1);
});
