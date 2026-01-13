import fs from 'fs-extra';
import path from 'path';

class EvidenceWriter {
  /**
   * Создает директорию для улик выполнения
   */
  async createRunDirectory(requestId: string, runId: string): Promise<string> {
    try {
      const evidenceDir = path.join('artifacts', 'mova_agent', requestId, 'runs', runId);
      await fs.ensureDir(evidenceDir);
      return evidenceDir;
    } catch (error: any) {
      throw new Error(`Failed to create evidence directory: ${error.message}`);
    }
  }

  /**
   * Записывает артефакт в директорию улик
   */
  async writeArtifact(evidenceDir: string, filename: string, data: any): Promise<void> {
    try {
      // Делаем редактирование чувствительных данных перед записью
      const sanitizedData = this.sanitizeData(data);
      const filePath = path.join(evidenceDir, filename);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeJson(filePath, sanitizedData, { spaces: 2 });
    } catch (error: any) {
      throw new Error(`Failed to write artifact ${filename}: ${error.message}`);
    }
  }

  /**
   * Удаляет чувствительные данные перед записью
   */
  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // Рекурсивная очистка данных
    const result = Array.isArray(data) ? [] : {};

    for (const [key, value] of Object.entries(data)) {
      // Проверяем, является ли ключ потенциально чувствительным
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('key') ||
        lowerKey.includes('auth')
      ) {
        // Заменяем чувствительные данные на маскированное представление
        if (typeof value === 'string') {
          (result as any)[key] = `*** REDACTED (length=${value.length}) ***`;
        } else if (typeof value === 'object') {
          (result as any)[key] = `*** REDACTED (object) ***`;
        } else {
          (result as any)[key] = `*** REDACTED ***`;
        }
      } else if (typeof value === 'object' && value !== null) {
        // Рекурсивно очищаем вложенные объекты
        (result as any)[key] = this.sanitizeData(value);
      } else {
        (result as any)[key] = value;
      }
    }

    return result;
  }
}

export { EvidenceWriter };
