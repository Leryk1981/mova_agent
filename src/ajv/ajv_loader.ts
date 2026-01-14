import Ajv from 'ajv';
import fs from 'fs-extra';
import path from 'path';
import {
  AjvSchemaLoader as CoreAjvSchemaLoader,
  ValidationResult,
} from '@leryk1981/mova-core-engine';
import { resolveMovaSpecRoot } from '../spec/spec_root_resolver';

// Класс для загрузки и валидации схем (обертка над core-engine)
class AjvSchemaLoader {
  private loader: CoreAjvSchemaLoader;
  private schemaCache: Map<string, any>;
  private schemaSourcePaths: Map<string, string>;
  private specSchemasDir: string;

  // Getter to access the AJV instance for advanced validation
  get getAjv(): Ajv {
    // core-engine уже настраивает AJV с addFormats/allErrors/strict=false
    return this.loader.validator as unknown as Ajv;
  }

  constructor() {
    this.loader = new CoreAjvSchemaLoader();
    this.schemaCache = new Map();
    this.schemaSourcePaths = new Map();
    const { schemasDir } = resolveMovaSpecRoot();
    this.specSchemasDir = schemasDir;
  }

  /**
   * Загружает схему из vendor/MOVA или из локальных схем проекта
   */
  async loadSchema(schemaId: string): Promise<any> {
    // Определяем путь к схеме
    let schemaPath: string;

    // First try local project schemas, then npm spec package, then vendor fallback
    const possibleBasePaths = [
      path.resolve(__dirname, '../../../schemas'), // Local schemas when built to build/src/ajv/
      path.resolve(__dirname, '../../schemas'), // Alternative local path
      this.specSchemasDir,
      path.resolve(__dirname, '../../../../schemas'), // Another local path option
      // Vendor schemas as fallback for MOVA schemas not found locally (dev mode)
      path.resolve(__dirname, '../../../vendor/MOVA/schemas'),
      path.resolve(__dirname, '../../vendor/MOVA/schemas'),
      path.resolve(__dirname, '../../../../vendor/MOVA/schemas'),
    ];

    let basePathFound = '';
    for (const basePath of possibleBasePaths) {
      const testPath = path.join(basePath, `${schemaId}.schema.json`);
      if (await fs.pathExists(testPath)) {
        basePathFound = basePath;
        break;
      }
    }

    if (basePathFound) {
      schemaPath = path.join(basePathFound, `${schemaId}.schema.json`);
    } else {
      // If no path was found, use the last possible path as fallback
      schemaPath = path.join(
        possibleBasePaths[possibleBasePaths.length - 1],
        `${schemaId}.schema.json`
      );
    }

    const cachedSchema = this.schemaCache.get(schemaId);
    const cachedPath = this.schemaSourcePaths.get(schemaId);
    if (cachedSchema && cachedPath === schemaPath) {
      return cachedSchema;
    }

    try {
      // Загружаем схему из файла
      const schemaContent = await fs.readJson(schemaPath);

      // Кэшируем схему
      this.schemaCache.set(schemaId, schemaContent);
      this.schemaSourcePaths.set(schemaId, schemaPath);

      return schemaContent;
    } catch (error: any) {
      throw new Error(`Failed to load schema ${schemaId} from ${schemaPath}: ${error.message}`);
    }
  }

  /**
   * Регистрирует схему в AJV
   */
  async registerSchema(schemaId: string): Promise<void> {
    const schema = await this.loadSchema(schemaId);

    // Проверяем, что схема имеет правильный $id
    if (!schema.$id) {
      // Если у схемы нет $id, устанавливаем его
      schema.$id = schemaId;
    }

    // Проверяем, не зарегистрирована ли схема уже
    if (!this.loader.getSchema(schema.$id)) {
      // Компилируем схему в AJV через core-engine
      try {
        this.loader.addSchema(schema, schemaId);
      } catch (error: any) {
        // Если ошибка связана с отсутствием зависимостей, это нормально
        if (
          error.message &&
          (error.message.includes('no schema') || error.message.includes('$ref'))
        ) {
          await this.loadSchemaDependencies(schema);
          const ajv = this.loader.validator as unknown as Ajv;
          ajv.removeSchema(schema.$id);
          this.loader.addSchema(schema, schemaId);
        } else {
          if (Array.isArray(error) || (error && typeof error === 'object' && 'message' in error)) {
            throw new Error(`Schema ${schemaId} validation error: ${(error as any).message}`);
          } else {
            throw error;
          }
        }
      }
    }
  }

  /**
   * Загружает зависимости схемы рекурсивно
   */
  private async loadSchemaDependencies(schema: any): Promise<void> {
    if (!schema || typeof schema !== 'object') {
      return;
    }

    // Ищем ссылки на другие схемы
    if (schema.$ref) {
      const ref = schema.$ref as string;
      if (ref.startsWith('https://') || ref.startsWith('http://')) {
        // Это внешняя ссылка, извлекаем ID схемы из URL
        const schemaId = this.extractSchemaIdFromUrl(ref);
        if (schemaId) {
          await this.registerSchema(schemaId);
        }
      } else if (ref.includes('.schema.json')) {
        // Это ссылка на файл, извлекаем ID схемы из имени файла
        const schemaId = ref.replace('.schema.json', '').replace('/', '.');
        await this.registerSchema(schemaId);
      }
    }

    // Рекурсивно обрабатываем свойства схемы
    for (const key in schema) {
      if (typeof schema[key] === 'object' && schema[key] !== null) {
        if (Array.isArray(schema[key])) {
          for (const item of schema[key]) {
            await this.loadSchemaDependencies(item);
          }
        } else {
          await this.loadSchemaDependencies(schema[key]);
        }
      }
    }
  }

  /**
   * Извлекает ID схемы из URL
   */
  private extractSchemaIdFromUrl(url: string): string | null {
    // Извлекаем имя файла из URL
    const parts = url.split('/');
    const fileName = parts[parts.length - 1];
    if (fileName.endsWith('.schema.json')) {
      return fileName.replace('.schema.json', '');
    }
    return null;
  }

  /**
   * Валидирует данные против схемы
   */
  async validate(schemaId: string, data: any): Promise<ValidationResult> {
    try {
      if (!this.loader.getSchema(schemaId)) {
        await this.registerSchema(schemaId);
      }
      return await this.loader.validate(schemaId, data);
    } catch (error: any) {
      return {
        ok: false,
        errors: [`Validation error: ${error.message}`],
      };
    }
  }

  /**
   * Проверяет, существует ли схема
   */
  async schemaExists(schemaId: string): Promise<boolean> {
    try {
      await this.loadSchema(schemaId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Возвращает список всех загруженных схем
   */
  getLoadedSchemas(): string[] {
    return Array.from(this.schemaCache.keys());
  }
}

// Экспортируем экземпляр загрузчика схем
const ajvLoader = new AjvSchemaLoader();

export { AjvSchemaLoader, ajvLoader, ValidationResult };

// Функция validate, которая требуется по спецификации
export async function validate(
  schemaId: string,
  data: any
): Promise<{ ok: boolean; errors?: any[] }> {
  return await ajvLoader.validate(schemaId, data);
}
