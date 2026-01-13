import assert from 'assert';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { writeEpisodeAtomic } from '../../src/episodes/episode_writer_atomic';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'episode-writer-'));
}

async function readJson(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.pathExists(filePath);
}

async function testSuccessfulWrite() {
  const tmpDir = createTempDir();
  const targetPath = path.join(tmpDir, 'episodes', 'episode.json');
  const data = { id: 'ep-1', status: 'ok' };

  await writeEpisodeAtomic(targetPath, data);

  const exists = await fileExists(targetPath);
  assert.strictEqual(exists, true, 'Episode file should exist');

  const saved = await readJson(targetPath);
  assert.deepStrictEqual(saved, data, 'Episode content should match input');

  const backupDir = path.join(path.dirname(targetPath), '_backup');
  const backups = (await fs.pathExists(backupDir)) ? await fs.readdir(backupDir) : [];
  assert.strictEqual(backups.length, 0, 'No backups should be created on first write');
}

async function testWriteFailurePreservesOriginal() {
  const tmpDir = createTempDir();
  const targetPath = path.join(tmpDir, 'episodes', 'episode.json');
  const originalData = { id: 'ep-1', status: 'original' };
  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeJson(targetPath, originalData, { spaces: 2 });

  // Monkeypatch fs.writeFile to throw once
  const originalWriteFile = fs.writeFile;
  let invoked = false;
  // @ts-expect-error override for test
  fs.writeFile = async (...args: any[]) => {
    if (!invoked) {
      invoked = true;
      throw new Error('Simulated write failure');
    }
    // @ts-ignore fallback to original
    return originalWriteFile.apply(fs, args);
  };

  let caught = false;
  try {
    await writeEpisodeAtomic(targetPath, { id: 'ep-1', status: 'new' });
  } catch (err) {
    caught = true;
    assert.strictEqual(
      (err as Error).message,
      'Simulated write failure',
      'Should propagate write error'
    );
  } finally {
    // restore
    // @ts-expect-error restore
    fs.writeFile = originalWriteFile;
  }

  assert.ok(caught, 'Error should be thrown on failed write');

  const preserved = await readJson(targetPath);
  assert.deepStrictEqual(preserved, originalData, 'Original file must remain unchanged');

  const backupDir = path.join(path.dirname(targetPath), '_backup');
  const backupExists = await fs.pathExists(backupDir);
  if (backupExists) {
    const backups = await fs.readdir(backupDir);
    assert.strictEqual(backups.length, 0, 'Backup should not be created on failed write');
  }
}

async function run() {
  await testSuccessfulWrite();
  await testWriteFailurePreservesOriginal();
  // eslint-disable-next-line no-console
  console.log('episode_writer_atomic tests passed');
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
