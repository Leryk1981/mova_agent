const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.error('Usage: node scripts/run_sdk_cli.js <npm-script>');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const cliRoot = path.join(root, 'sdk-cli');
const cliPackageJson = path.join(cliRoot, 'package.json');

if (!fs.existsSync(cliPackageJson)) {
  console.warn(
    `Warning: sdk-cli/package.json not found at ${cliPackageJson}. Skipping sdk-cli ${command}.`
  );
  process.exit(0);
}

const result = spawnSync('npm', ['--prefix', cliRoot, 'run', command], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`Failed to run sdk-cli ${command}:`, result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
