import fs from 'fs-extra';
import path from 'path';

/**
 * Atomically writes an episode file with backup preservation.
 * Steps:
 * 1) Serialize data to JSON.
 * 2) Write to <target>.tmp.
 * 3) If <target> exists, copy it to episodes/_backup/<timestamp>_<basename>.bak.
 * 4) Rename tmp to target (atomic replace).
 */
export async function writeEpisodeAtomic(targetPath: string, data: any): Promise<void> {
  const serialized = JSON.stringify(data, null, 2);
  const tempPath = `${targetPath}.tmp`;
  const dir = path.dirname(targetPath);
  const backupDir = path.join(dir, '_backup');
  const baseName = path.basename(targetPath);
  const backupName = `${Date.now()}_${baseName}.bak`;
  const backupPath = path.join(backupDir, backupName);

  await fs.ensureDir(dir);
  await fs.ensureDir(backupDir);

  const originalExists = await fs.pathExists(targetPath);

  try {
    await fs.writeFile(tempPath, serialized, { encoding: 'utf8' });

    if (originalExists) {
      // Keep original intact in case rename fails
      await fs.copyFile(targetPath, backupPath);
    }

    // Replace original with temp atomically
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    // Clean up temp file if it was written
    if (await fs.pathExists(tempPath)) {
      await fs.remove(tempPath);
    }
    // If something went wrong before rename, ensure original stays
    throw error;
  }
}
