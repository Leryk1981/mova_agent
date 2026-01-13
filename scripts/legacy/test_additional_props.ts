// @ts-nocheck
#!/usr/bin/env node

// Test script to verify no additional properties warnings
const fs = require('fs-extra');
const path = require('path');

// Capture console warnings to check for additional properties warnings
const originalWarn = console.warn;
const warnings = [];

console.warn = (...args) => {
  const msg = args.join(' ');
  if (msg.toLowerCase().includes('additional') || msg.toLowerCase().includes('validation')) {
    warnings.push(msg);
    console.log('CAPTURED WARNING:', msg);
  }
  originalWarn(...args);
};

async function runTest() {
  console.log('Testing for additional properties warnings...');
  
  // Run both quality suites
  await require('./quality_pos.js').runPositiveQualitySuite();
  await require('./quality_neg.js').runNegativeQualitySuite();
  
  console.log('\n--- RESULTS ---');
  if (warnings.length === 0) {
    console.log('✅ SUCCESS: No additional properties warnings found!');
  } else {
    console.log(`❌ FAILED: Found ${warnings.length} warnings:`);
    warnings.forEach((w, i) => console.log(`${i + 1}. ${w}`));
  }
  
  // Restore original console.warn
  console.warn = originalWarn;
  
  return warnings.length === 0;
}

runTest()
  .then(success => {
    if (!success) {
      process.exit(1); // Fail if warnings were found
    }
  })
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
