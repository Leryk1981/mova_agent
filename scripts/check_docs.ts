import fs from 'fs';
import path from 'path';

const DOCS_DIR = path.resolve(__dirname, '..', 'docs');
const RU_DIR = path.join(DOCS_DIR, 'ru');

function isMarkdown(file: string): boolean {
  return file.toLowerCase().endsWith('.md');
}

function verifyDoc(filePath: string, violations: string[]): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) || '';
  if (!firstLine.trim().startsWith('#')) {
    violations.push(`${path.relative(process.cwd(), filePath)}: missing top-level heading (# ...)`);
  }
}

function walkDocs(dir: string, violations: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.startsWith(RU_DIR)) continue; // skip Russian originals
      walkDocs(fullPath, violations);
      continue;
    }
    if (entry.isFile() && isMarkdown(entry.name)) {
      verifyDoc(fullPath, violations);
    }
  }
}

function main() {
  const violations: string[] = [];
  walkDocs(DOCS_DIR, violations);

  if (violations.length > 0) {
    console.error('Documentation check failed:');
    for (const v of violations) {
      console.error(`- ${v}`);
    }
    process.exit(1);
  }

  console.log('All docs verified.');
}

main();
