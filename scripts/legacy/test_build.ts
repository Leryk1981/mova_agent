// @ts-nocheck
const { exec } = require('child_process');

exec('npx tsc', (error, stdout, stderr) => {
  if (error) {
    console.error(`Build failed: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
  }
  console.log(`stdout: ${stdout}`);
});
