// @ts-nocheck
const fs = require('fs-extra');
const path = require('path');

// Capture console.warn to detect any validation warnings
const originalWarn = console.warn;
let warnings = [];
console.warn = (...args) => {
  const msg = args.join(' ');
  if (msg.includes('validation warning')) {
    warnings.push(msg);
    console.log('CAPTURED WARNING:', msg);
  } else {
    originalWarn(...args);
  }
};

async function runTests() {
  console.log('Running quality tests to check for validation warnings...');

  try {
    // Run positive test
    console.log('\\n--- Running POS test ---');
    await require('./quality_pos.js');

    // Wait a bit for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Run negative test
    console.log('\\n--- Running NEG test ---');
    await require('./quality_neg.js');

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log('\\n=== VALIDATION WARNINGS SUMMARY ===');
    if (warnings.length === 0) {
      console.log('SUCCESS: No validation warnings found!');
    } else {
      console.log(`FOUND ${warnings.length} validation warning(s):`);
      warnings.forEach((w, i) => console.log(`${i + 1}. ${w}`));
    }
    console.log('==================================');
  } catch (error) {
    console.error('Error running tests:', error);
  }

  // Restore original warn
  console.warn = originalWarn;
}

runTests();
