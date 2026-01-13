// @ts-nocheck
console.log('Test start');

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

console.log('Required modules');

async function test() {
  console.log('Creating dirs...');
  const qualityRunId = `run_${Date.now()}_${uuidv4().split('-')[0]}`;
  const qualityRequestId = `req_${Date.now()}_${uuidv4().split('-')[0]}`;
  const qualityEvidenceDir = path.join(
    'artifacts',
    'quality',
    'neg',
    qualityRequestId,
    'runs',
    qualityRunId
  );
  await fs.ensureDir(qualityEvidenceDir);

  console.log('Created dir:', qualityEvidenceDir);
}

test()
  .then(() => console.log('Test completed'))
  .catch((err) => console.error('Test error:', err));
