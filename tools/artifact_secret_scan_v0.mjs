import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_DIR = 'artifacts/quality';
const TEXT_EXT = ['.json', '.md', '.log', '.txt'];
const PATTERNS = [
  'authorization: bearer',
  'test_secret_v1',
  'token=',
  'secret=',
  'api_key'
];

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXT.includes(ext);
}

function hashSnippet(snippet) {
  return crypto.createHash('sha256').update(snippet, 'utf8').digest('hex').slice(0, 12);
}

async function scanFile(filePath) {
  try {
    if (!isTextFile(filePath)) return [];
    const content = await fs.readFile(filePath, 'utf8');
    const lower = content.toLowerCase();
    const matches = [];
    for (const pat of PATTERNS) {
      if (lower.includes(pat)) {
        matches.push({ pattern: pat, snippet_hash: hashSnippet(pat) });
      }
    }
    return matches.map((m) => ({ file: filePath, ...m }));
  } catch {
    return [];
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  let dir = DEFAULT_DIR;
  let runId = `scan_${Date.now()}`;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) dir = args[i + 1];
    if (args[i] === '--run-id' && args[i + 1]) runId = args[i + 1];
  }

  const files = (await fs.pathExists(dir)) ? await walk(dir) : [];
  const matches = [];
  for (const file of files) {
    matches.push(...(await scanFile(file)));
  }
  const status = matches.length === 0 ? 'passed' : 'failed';
  const reportDir = path.join('artifacts', 'quality', runId);
  await fs.ensureDir(reportDir);
  const reportPath = path.join(reportDir, 'secret_scan_report.json');
  await fs.writeJson(reportPath, { status, dir, matches, run_id: runId }, { spaces: 2 });
  if (status !== 'passed') {
    console.error('[secret-scan] FAIL', reportPath);
    process.exit(1);
  }
  console.log('[secret-scan] PASS', reportPath);
}

main().catch((err) => {
  console.error('[secret-scan] FAIL', err.message);
  process.exit(1);
});
