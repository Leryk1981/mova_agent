import { AjvSchemaLoader } from './ajv_loader';
import * as fs from 'fs-extra';
import * as path from 'path';
import { getLogger } from '../logging/logger';
import { resolveMovaSpecRoot } from '../spec/spec_root_resolver';

class SchemaRegistry {
  private loader: AjvSchemaLoader;

  constructor(loader: AjvSchemaLoader) {
    this.loader = loader;
  }

  /**
   * Loads all vendor/MOVA schemas
   */
  async loadAllMovaSchemas(): Promise<void> {
    const logger = getLogger();
    let movaSchemasDir: string | null = null;
    try {
      movaSchemasDir = resolveMovaSpecRoot().schemasDir;
    } catch (e: any) {
      logger.error(`MOVA spec resolver failed: ${e?.message || e}`);
    }

    if (movaSchemasDir && (await fs.pathExists(movaSchemasDir))) {
      const schemaFiles = await fs.readdir(movaSchemasDir);

      for (const file of schemaFiles) {
        if (file.endsWith('.schema.json')) {
          const schemaId = file.replace('.schema.json', '');
          logger.info(`Loading MOVA schema: ${schemaId}`);
          try {
            await this.loader.registerSchema(schemaId);
            logger.info(`✓ Successfully loaded MOVA schema: ${schemaId}`);
          } catch (error: any) {
            logger.error(`✗ Failed to load MOVA schema ${schemaId}: ${error.message}`);
          }
        }
      }
    } else {
      logger.error(`MOVA schemas directory not found (resolved: ${movaSchemasDir || 'n/a'})`);
    }
  }

  /**
   * Loads all local project schemas
   */
  async loadAllLocalSchemas(): Promise<void> {
    const logger = getLogger();
    const localSchemasDir = path.join(__dirname, '..', '..', '..', 'schemas');

    if (await fs.pathExists(localSchemasDir)) {
      const schemaFiles = await fs.readdir(localSchemasDir);

      for (const file of schemaFiles) {
        if (file.endsWith('.schema.json')) {
          const schemaId = file.replace('.schema.json', '');
          logger.info(`Loading local schema: ${schemaId}`);
          try {
            await this.loader.registerSchema(schemaId);
            logger.info(`✓ Successfully loaded local schema: ${schemaId}`);
          } catch (error: any) {
            logger.error(`✗ Failed to load local schema ${schemaId}: ${error.message}`);
          }
        }
      }
    } else {
      logger.error(`Local schemas directory not found: ${localSchemasDir}`);
    }
  }

  /**
   * Loads all schemas (both vendor and local)
   */
  async loadAllSchemas(): Promise<void> {
    const logger = getLogger();
    logger.info('Loading all MOVA schemas...');
    // Register base core schemas first to ensure $ref resolution
    const coreOrder = ['ds.mova_schema_core_v1', 'ds.mova_episode_core_v1'];
    for (const coreId of coreOrder) {
      try {
        logger.info(`Preloading core schema: ${coreId}`);
        await this.loader.registerSchema(coreId);
        logger.info(`✓ Preloaded core schema: ${coreId}`);
      } catch (e: any) {
        logger.error(`✗ Preload failed for core schema ${coreId}: ${e.message}`);
      }
    }
    await this.loadAllMovaSchemas();

    logger.info('Loading all local schemas...');
    await this.loadAllLocalSchemas();
  }
}

// Export the registry for use in other modules
export { SchemaRegistry };
