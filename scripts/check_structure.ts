import fs from 'fs';
import path from 'path';

const allowedRoots = new Set([
  'src',
  'scripts',
  'test',
  'tests',
  'docs',
  'configs',
  'tools',
  'sdk-cli',
  'vendor',
  '.github',
]);
const ignored = new Set([
  'node_modules',
  'build',
  'dist',
  'artifacts',
  'temp_dist',
  'test_dist',
  '.git',
]);

function walk(dir: string, violations: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, violations);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const rel = path.relative(process.cwd(), fullPath);
      const top = rel.split(path.sep)[0];
      if (!allowedRoots.has(top)) {
        violations.push(rel);
      }
    }
  }
}

function main() {
  const violations: string[] = [];
  walk(process.cwd(), violations);
  if (violations.length > 0) {
    console.error('Found TypeScript files outside allowed directories:', violations);
    process.exit(1);
  } else {
    console.log('Structure check passed: no stray TypeScript files.');
  }
}

main();
