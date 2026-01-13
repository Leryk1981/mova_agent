import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs-extra';
import path from 'path';
// Тип для результатов валидации
interface ValidationResult {
  ok: boolean;
  errors?: string[];
}

// Класс для загрузки и валидации схем
class AjvSchemaLoader {
  private ajv: Ajv;
  private schemaCache: Map<string, any>;
  private schemaSourcePaths: Map<string, string>;

  // Getter to access the AJV instance for advanced validation
  get getAjv(): Ajv {
    return this.ajv;
  }

  constructor() {
    // Инициализация AJV с нужными опциями
    this.ajv = new Ajv({
      strict: false, // Disable strict mode to handle complex schemas
      allErrors: true,
      validateFormats: true,
      // Разрешить использование метасхем
      validateSchema: false, // Отключаем валидацию схем при добавлении
      // Для поддержки JSON Schema Draft 2020-12
      $data: true,
    });

    // Добавляем поддержку форматов
    addFormats(this.ajv);

    // Кэш для загруженных схем
    this.schemaCache = new Map();
    this.schemaSourcePaths = new Map();
  }

  /**
   * Загружает схему из vendor/MOVA или из локальных схем проекта
   */
  async loadSchema(schemaId: string): Promise<any> {
    // Определяем путь к схеме
    let schemaPath: string;
    let isProjectSchema = false;

    // First try local project schemas, then vendor schemas as fallback
    const possibleBasePaths = [
      path.resolve(__dirname, '../../../schemas'), // Local schemas when built to build/src/ajv/
      path.resolve(__dirname, '../../schemas'), // Alternative local path
      path.resolve(__dirname, '../../../../schemas'), // Another local path option
      // Vendor schemas as fallback for MOVA schemas not found locally
      path.resolve(__dirname, '../../../vendor/MOVA/schemas'), // From build/src/ajv/
      path.resolve(__dirname, '../../vendor/MOVA/schemas'), // Alternative from build/src/ajv/
      path.resolve(__dirname, '../../../../vendor/MOVA/schemas'), // From build/tools/ or similar
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
      // Если это схема проекта и файл не найден, попробуем найти в директории schemas с расширением
      if (isProjectSchema && !(await fs.pathExists(schemaPath))) {
        // Пробуем альтернативные пути для схем проекта
        for (const basePath of [
          path.resolve(__dirname, '../../../schemas'),
          path.resolve(__dirname, '../../schemas'),
        ]) {
          const altSchemaPath = path.join(basePath, `${schemaId}.schema.json`);

          if (await fs.pathExists(altSchemaPath)) {
            const schemaContent = await fs.readJson(altSchemaPath);
            this.schemaCache.set(schemaId, schemaContent);
            this.schemaSourcePaths.set(schemaId, altSchemaPath);
            return schemaContent;
          }
        }
      }

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
    if (!this.ajv.getSchema(schema.$id)) {
      // Компилируем схему в AJV
      try {
        this.ajv.addSchema(schema);
      } catch (error: any) {
        // Если ошибка связана с отсутствием зависимостей, это нормально
        // Мы должны сначала загрузить все зависимости, а затем зарегистрировать схему
        if (
          error.message &&
          (error.message.includes('no schema') || error.message.includes('$ref'))
        ) {
          // Попробуем рекурсивно загрузить зависимости
          await this.loadSchemaDependencies(schema);

          // После загрузки зависимостей, повторно попробуем зарегистрировать схему
          // Remove existing schema first if it was added partially
          if (this.ajv.getSchema(schema.$id)) {
            this.ajv.removeSchema(schema.$id);
          }
          this.ajv.addSchema(schema);
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
      // Проверяем, зарегистрирована ли схема
      if (!this.ajv.getSchema(schemaId)) {
        await this.registerSchema(schemaId);
      }

      // Получаем валидатор для схемы
      const validate = this.ajv.getSchema(schemaId);

      if (!validate) {
        // If schema is not compiled, try to compile it directly
        const schema = await this.loadSchema(schemaId);
        if (!schema.$id) {
          schema.$id = schemaId;
        }

        // Compile the schema directly
        const compiledValidate = this.ajv.compile(schema);

        // Execute validation with the compiled function
        const valid = compiledValidate(data);

        if (valid) {
          return { ok: true };
        } else {
          // Формируем сообщения об ошибках
          const errors =
            compiledValidate.errors?.map(
              (error) => `${error.instancePath || 'data'} ${error.message || ''}`
            ) || [];

          return {
            ok: false,
            errors,
          };
        }
      }

      // Выполняем валидацию
      const valid = validate(data);

      if (valid) {
        return { ok: true };
      } else {
        // Формируем сообщения об ошибках
        const errors =
          validate.errors?.map(
            (error) => `${error.instancePath || 'data'} ${error.message || ''}`
          ) || [];

        return {
          ok: false,
          errors,
        };
      }
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
