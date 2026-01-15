import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'proofkits', 'registry_v0.json');

function parseArgs(argv) {
  const args = { id: null, all: false };
  const idIndex = argv.indexOf('--id');
  if (idIndex >= 0 && argv[idIndex + 1]) {
    args.id = argv[idIndex + 1];
  }
  if (!args.id) {
    const firstPositional = argv.find((arg) => !arg.startsWith('-'));
    if (firstPositional) {
      args.id = firstPositional;
    }
  }
  args.all = argv.includes('--all');
  return args;
}

function runScript(script) {
  const result = spawnSync(script, { stdio: 'inherit', shell: true });
  return { status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status || 1 };
}

async function loadRegistry() {
  if (!(await fs.pathExists(REGISTRY_PATH))) {
    throw new Error(`Registry not found at ${REGISTRY_PATH}`);
  }
  return fs.readJson(REGISTRY_PATH);
}

async function loadManifest(manifestPath) {
  const resolved = path.isAbsolute(manifestPath) ? manifestPath : path.join(ROOT, manifestPath);
  if (!(await fs.pathExists(resolved))) {
    throw new Error(`Manifest not found at ${resolved}`);
  }
  return fs.readJson(resolved);
}

function selectProofkits(registry, args) {
  const kits = registry.proofkits || [];
  if (args.id) {
    const found = kits.find((k) => k.id === args.id);
    if (!found) {
      throw new Error(`ProofKit with id ${args.id} not found in registry`);
    }
    return [found];
  }
  return kits;
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push(`# ProofKit run ${summary.run_id}`);
  lines.push(`Status: ${summary.status}`);
  lines.push('');
  for (const kit of summary.proofkits) {
    lines.push(`## ${kit.id} (${kit.version})`);
    lines.push(`Status: ${kit.status}`);
    for (const scenario of kit.scenarios) {
      lines.push(
        `- ${scenario.name}: ${scenario.status} (script: ${scenario.script}, exit: ${scenario.exit_code})`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = await loadRegistry();
  const kits = selectProofkits(registry, args);

  const runId = `proofkit_run_${Date.now()}`;
  const runDir = path.join(ROOT, 'artifacts', 'proofkits', runId);
  await fs.ensureDir(runDir);

  const summary = {
    run_id: runId,
    started_at: new Date().toISOString(),
    status: 'passed',
    proofkits: [],
  };

  for (const kit of kits) {
    const manifest = await loadManifest(kit.manifest);
    const scenarios = [];

    const posScript = (kit.scripts && kit.scripts.pos) || manifest.scripts?.pos;
    const negScript = (kit.scripts && kit.scripts.neg) || manifest.scripts?.neg;

    if (posScript) {
      const result = runScript(posScript);
      scenarios.push({
        name: 'pos',
        status: result.status,
        exit_code: result.exitCode,
        script: posScript,
        evidence_base: manifest.evidence?.pos_base || kit.evidence?.pos_dir,
      });
    }

    if (negScript) {
      const result = runScript(negScript);
      scenarios.push({
        name: 'neg',
        status: result.status,
        exit_code: result.exitCode,
        script: negScript,
        evidence_base: manifest.evidence?.neg_base || kit.evidence?.neg_dir,
      });
    }

    const kitStatus = scenarios.every((s) => s.status === 'passed') ? 'passed' : 'failed';
    summary.proofkits.push({
      id: kit.id,
      version: kit.version || manifest.version,
      manifest: kit.manifest,
      status: kitStatus,
      scenarios,
    });

    if (kitStatus !== 'passed') {
      summary.status = 'failed';
    }
  }

  summary.finished_at = new Date().toISOString();

  const jsonPath = path.join(runDir, 'proofkit_summary.json');
  const mdPath = path.join(runDir, 'proofkit_summary.md');

  await fs.writeJson(jsonPath, summary, { spaces: 2 });
  await fs.writeFile(mdPath, buildMarkdown(summary), 'utf8');

  if (summary.status !== 'passed') {
    console.error(`[proofkit_run] FAIL (summary at ${jsonPath})`);
    process.exit(1);
  }

  console.log(`[proofkit_run] PASS (summary at ${jsonPath})`);
}

main().catch((error) => {
  console.error('[proofkit_run] ERROR', error.message);
  process.exit(1);
});
