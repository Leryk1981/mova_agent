import fs from 'fs-extra';
import path from 'path';
import { redactObject } from './redact_v0';

class EvidenceWriter {
  async createRunDirectory(requestId: string, runId: string): Promise<string> {
    try {
      const evidenceDir = path.join('artifacts', 'mova_agent', requestId, 'runs', runId);
      await fs.ensureDir(evidenceDir);
      return evidenceDir;
    } catch (error: any) {
      throw new Error('Failed to create evidence directory: ' + error.message);
    }
  }

  async writeArtifact(evidenceDir: string, filename: string, data: any): Promise<void> {
    try {
      const sanitizedData = redactObject(data);
      const filePath = path.join(evidenceDir, filename);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeJson(filePath, sanitizedData, { spaces: 2 });
    } catch (error: any) {
      throw new Error('Failed to write artifact ' + filename + ': ' + error.message);
    }
  }
}

export { EvidenceWriter };
