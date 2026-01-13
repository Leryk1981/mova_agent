import assert from 'assert';
import { registerDriver, getDriver } from '../../src/drivers';
import { httpDriverFactory } from '../../src/drivers/httpDriver';
import {
  restrictedShellDriverFactory,
  __setExecFileRunner,
  __getExecFileRunner,
} from '../../src/drivers/restrictedShellDriver';

async function testRegisterAndGet() {
  registerDriver('test_driver', () => ({
    async execute(input: any) {
      return { echo: input };
    },
  }));

  const driver = getDriver('test_driver');
  const result = await driver.execute({ ping: true });
  assert.deepStrictEqual(result, { echo: { ping: true } });
}

async function testGetUnknownThrows() {
  let threw = false;
  try {
    getDriver('unknown_driver');
  } catch (error: any) {
    threw = true;
    assert.ok(error.message.includes('Driver not found'));
  }
  assert.ok(threw, 'Expected getDriver to throw for unknown driver');
}

async function testHttpDriver() {
  const driver = httpDriverFactory();

  // Mock fetch
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, init?: any) => {
    return {
      status: 200,
      async text() {
        return JSON.stringify({ url, method: init?.method || 'GET' });
      },
      headers: {
        entries: () => [],
      },
    } as any;
  }) as any;

  const result = await driver.execute(
    { url: 'https://example.com', method: 'GET' },
    { allowlist: ['https://example.com'] }
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body, { url: 'https://example.com', method: 'GET' });

  // disallow
  let blocked = false;
  try {
    await driver.execute(
      { url: 'https://not-allowed.test' },
      { allowlist: ['https://example.com'] }
    );
  } catch (err: any) {
    blocked = true;
    assert.ok(err.message.includes('allowlisted'));
  }
  assert.ok(blocked, 'Should block URL not in allowlist');

  global.fetch = originalFetch as any;
}

async function testRestrictedShellDriver() {
  const driver = restrictedShellDriverFactory();

  // Mock execFile runner
  const originalRunner = __getExecFileRunner();
  __setExecFileRunner(async (cmd: string, args: readonly string[] | null = []) => {
    const safeArgs = args ?? [];
    return {
      stdout: `ran ${cmd} ${safeArgs.join(' ')}`,
      stderr: '',
    };
  });

  const result = await driver.execute(
    { command: 'echo', args: ['hello'] },
    { allowlist: ['echo'] }
  );
  assert.strictEqual(result.exit_code, 0);
  assert.ok(result.stdout.includes('echo hello'));

  let blocked = false;
  try {
    await driver.execute({ command: 'rm', args: ['-rf', '/'] }, { allowlist: ['echo'] });
  } catch (err: any) {
    blocked = true;
    assert.ok(err.message.includes('allowlisted'));
  }
  assert.ok(blocked, 'Should block command not in allowlist');
  // restore
  __setExecFileRunner(originalRunner);
}

async function run() {
  await testRegisterAndGet();
  await testGetUnknownThrows();
  await testHttpDriver();
  await testRestrictedShellDriver();
  // eslint-disable-next-line no-console
  console.log('driver registry tests passed');
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
