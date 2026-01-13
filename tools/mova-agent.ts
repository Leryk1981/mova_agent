import { CLIInterface } from '../src/ux/cli_interface';

async function main() {
  try {
    const cli = new CLIInterface();
    await cli.run(process.argv.slice(2));
  } catch (error: any) {
    console.error('CLI Error:', error.message);
    process.exit(1);
  }
}

main();