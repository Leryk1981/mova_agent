// @ts-nocheck
const { spawn } = require('child_process');

const tsc = spawn('npx', ['tsc']);

tsc.stdout.on('data', (data) => {
  console.log(`stdout: ${data}`);
});

tsc.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
});

tsc.on('close', (code) => {
  console.log(`child process exited with code ${code}`);
});
