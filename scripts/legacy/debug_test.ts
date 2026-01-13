// @ts-nocheck
// Simple test to see if there are import issues
console.log('Starting test...');

// Try to dynamically import the module
(async () => {
  try {
    const { CliInterface } = await import('./build/src/ux/cli_interface.js');
    console.log('Import successful');
    const cli = new CliInterface();
    console.log('CLI instance created');
  } catch (error) {
    console.error('Import error:', error.message);
  }
})();

console.log('Test completed');
