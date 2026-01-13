import fs from 'fs-extra';
import path from 'path';
import type { ErrorObject } from 'ajv';
import { validate, ajvLoader } from '../ajv/ajv_loader';
import { getLogger } from '../logging/logger';

const logger = getLogger();

interface MovaEpisode {
  episode_id: string;
  episode_type: string;
  mova_version: string;
  recorded_at: string;
  started_at?: string;
  finished_at?: string;
  input_envelopes?: Array<{
    envelope_type: string;
    envelope_id?: string;
  }>;
  input_data_refs?: Array<{
    data_type: string;
    data_id?: string;
  }>;
  executor: {
    executor_id: string;
    role?: string;
    executor_kind?: string;
    environment?: any;
  };
  result_status:
    | 'pending'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'partial'
    | 'cancelled'
    | 'skipped';
  result_summary: string;
  result_details?: any;
  output_data_refs?: Array<{
    data_type: string;
    data_id?: string;
  }>;
  meta_episode?: {
    request_id?: string;
    run_id?: string;
    evidence_dir?: string;
    [key: string]: any;
  };
  [key: string]: any; // Allow additional properties
}

interface SecurityEventEpisode extends MovaEpisode {
  episode_type: string; // Must match pattern ^security_event(/.+)?$
  security_event_type: string;
  security_event_category:
    | 'auth'
    | 'authorization'
    | 'policy_violation'
    | 'instruction_misuse'
    | 'data_access'
    | 'rate_limit'
    | 'config'
    | 'infrastructure'
    | 'other';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  policy_profile_id: string;
  policy_ref?: {
    policy_document_id?: string;
    rule_id?: string;
    policy_version?: string;
  };
  security_model_version: string;
  detection_source: 'human_review' | 'rule_engine' | 'runtime_guard' | 'external_system' | 'other';
  detection_confidence?: number;
  recommended_actions?: Array<{
    action_type: string;
    reason?: string;
    priority?: 'low' | 'medium' | 'high';
  }>;
  actions_taken?: Array<{
    action_type: string;
    taken_at?: string;
    actor?: string;
    status: 'completed' | 'failed' | 'skipped';
    details?: string;
  }>;
}

class EpisodeWriter {
  private baseEvidenceDir: string;

  constructor(baseEvidenceDir?: string) {
    this.baseEvidenceDir = baseEvidenceDir || path.join('artifacts', 'mova_agent');
    fs.ensureDirSync(this.baseEvidenceDir);
  }

  /**
   * Creates a run-specific episode writer
   */
  createRunWriter(requestId: string, runId: string): RunEpisodeWriter {
    return new RunEpisodeWriter(this.baseEvidenceDir, requestId, runId);
  }
}

class RunEpisodeWriter {
  private episodesDir: string;
  private requestId: string;
  private runId: string;

  constructor(baseEvidenceDir: string, requestId: string, runId: string) {
    this.requestId = requestId;
    this.runId = runId;
    this.episodesDir = path.join(baseEvidenceDir, requestId, 'runs', runId, 'episodes');
    fs.ensureDirSync(this.episodesDir);
  }

  /**
   * Writes an execution episode in MOVA 4.1.1 format
   */
  async writeExecutionEpisode(episodeData: Partial<MovaEpisode>): Promise<string> {
    const episodeId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const movaEpisode: MovaEpisode = {
      episode_id: episodeId,
      episode_type: episodeData.episode_type || 'execution_step',
      mova_version: '4.1.1',
      recorded_at: new Date().toISOString(),
      executor: episodeData.executor || {
        executor_id: 'mova_agent_runtime',
        role: 'agent',
        executor_kind: 'tool',
        environment: {
          platform: process.platform,
          arch: process.arch,
          node_version: process.version,
        },
      },
      result_status: episodeData.result_status || 'completed',
      result_summary: episodeData.result_summary || 'Execution step completed',
      input_envelopes: episodeData.input_envelopes || [],
      input_data_refs: episodeData.input_data_refs || [],
      meta_episode: {
        request_id: this.requestId,
        run_id: this.runId,
        evidence_dir: this.episodesDir,
        ...episodeData.meta_episode, // Include any additional meta data from input
      },
      // Only include explicitly allowed fields at the top level to avoid additionalProperties validation errors
      started_at: episodeData.started_at,
      finished_at: episodeData.finished_at,
      result_details: episodeData.result_details,
      output_data_refs: episodeData.output_data_refs,
    };

    // Add any additional properties that were in episodeData to meta_episode to avoid validation errors
    const allowedTopLevelFields = new Set([
      'episode_id',
      'episode_type',
      'mova_version',
      'recorded_at',
      'started_at',
      'finished_at',
      'input_envelopes',
      'input_data_refs',
      'executor',
      'result_status',
      'result_summary',
      'result_details',
      'output_data_refs',
      'meta_episode',
      'payload', // Adding payload as it's commonly used
    ]);

    // Add any extra fields to meta_episode to avoid additionalProperties errors
    for (const [key, value] of Object.entries(episodeData)) {
      if (!allowedTopLevelFields.has(key)) {
        if (!movaEpisode.meta_episode) {
          movaEpisode.meta_episode = {};
        }
        (movaEpisode.meta_episode as any)[key] = value;
      }
    }

    // Validate against MOVA core schema
    const validation = await validate('ds.mova_episode_core_v1', movaEpisode);
    if (!validation.ok) {
      logger.info(`Execution episode validation warning: ${validation.errors?.join(', ')}`);
    }

    const episodeFilePath = path.join(this.episodesDir, `${episodeId}.json`);
    await fs.writeJson(episodeFilePath, movaEpisode, { spaces: 2 });

    // Append to index
    await this.appendToIndex(episodeId, movaEpisode);

    return episodeId;
  }

  /**
   * Writes a security event episode in MOVA 4.1.1 format
   */
  // Sanitize security event to ensure it conforms to schema
  private sanitizeSecurityEvent(securityEvent: SecurityEventEpisode): SecurityEventEpisode {
    // Create a new object with only the allowed properties
    const sanitized: any = {};

    // Copy allowed top-level properties
    const allowedTopLevelProps = [
      'episode_id',
      'episode_type',
      'mova_version',
      'recorded_at',
      'started_at',
      'finished_at',
      'input_envelopes',
      'input_data_refs',
      'executor',
      'result_status',
      'result_summary',
      'output_data_refs',
      'meta_episode',
      'security_event_type',
      'security_event_category',
      'severity',
      'policy_profile_id',
      'policy_ref',
      'security_model_version',
      'detection_source',
      'detection_confidence',
      'recommended_actions',
      'actions_taken',
      'payload',
    ];

    for (const prop of allowedTopLevelProps) {
      if ((securityEvent as any)[prop] !== undefined) {
        sanitized[prop] = (securityEvent as any)[prop];
      }
    }

    // Sanitize meta_episode to ensure it only contains allowed properties
    if (securityEvent.meta_episode) {
      sanitized.meta_episode = { ...securityEvent.meta_episode }; // shallow copy
    }

    return sanitized as SecurityEventEpisode;
  }

  async writeSecurityEvent(securityEventData: Partial<SecurityEventEpisode>): Promise<string> {
    const eventId = `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create the base security event with default values, ensuring only allowed properties are included
    const allowedFields = [
      'episode_id',
      'episode_type',
      'mova_version',
      'recorded_at',
      'started_at',
      'finished_at',
      'input_envelopes',
      'input_data_refs',
      'executor',
      'result_status',
      'result_summary',
      'result_details',
      'output_data_refs',
      'meta_episode',
      'security_event_type',
      'security_event_category',
      'severity',
      'policy_profile_id',
      'policy_ref',
      'security_model_version',
      'detection_source',
      'detection_confidence',
      'recommended_actions',
      'actions_taken',
      'payload',
    ];

    // Start with default values
    const baseSecurityEvent: any = {
      episode_id: eventId,
      episode_type: 'security_event/policy_violation',
      mova_version: '4.1.1',
      recorded_at: new Date().toISOString(),
      executor: {
        executor_id: 'mova_agent_runtime',
        role: 'security_monitor',
        executor_kind: 'guard',
      },
      result_status: 'failed',
      result_summary: 'Security event detected',
      security_event_type: 'policy_violation',
      security_event_category: 'policy_violation',
      severity: 'high',
      policy_profile_id: 'mova_security_default_v1',
      security_model_version: '1.0.0',
      detection_source: 'runtime_guard',
      input_envelopes: [],
      input_data_refs: [],
      meta_episode: {
        request_id: this.requestId,
        run_id: this.runId,
        evidence_dir: this.episodesDir,
      },
    };

    // Only add properties from securityEventData that are allowed
    for (const field of allowedFields) {
      if (field in securityEventData && securityEventData[field] !== undefined) {
        baseSecurityEvent[field] = securityEventData[field as keyof SecurityEventEpisode];
      }
    }

    // The baseSecurityEvent already contains only allowed fields, so use it directly
    const strictSecurityEvent = baseSecurityEvent;

    // Validate the security event
    const validation = await validate('ds.security_event_episode_core_v1', strictSecurityEvent);

    let sanitizedSecurityEvent = strictSecurityEvent;

    if (!validation.ok) {
      // Check if there are additionalProperties errors that we can fix
      const additionalPropErrors = validation.errors?.filter(
        (error: string) =>
          error.includes('additional properties') ||
          error.includes('must NOT have additional properties')
      );

      if (additionalPropErrors && additionalPropErrors.length > 0) {
        // Use AJV directly to get detailed errors
        const ajvInstance = ajvLoader.getAjv;
        const validateFunc = ajvInstance.getSchema('ds.security_event_episode_core_v1');

        if (validateFunc) {
          // First validation to get detailed errors
          const isValid = validateFunc(strictSecurityEvent);

          if (!isValid && validateFunc.errors) {
            // Filter for additionalProperties errors only
            const additionalErrors = validateFunc.errors.filter(
              (error: ErrorObject) => error.keyword === 'additionalProperties'
            );

            if (additionalErrors.length > 0) {
              // Create before strip artifact
              const beforeStripPath = path.join(
                path.dirname(this.episodesDir),
                'security_event_episode_before_strip.json'
              );
              await fs.writeJson(beforeStripPath, strictSecurityEvent, { spaces: 2 });

              // Apply strip function
              const strippedEvent = await this.stripAdditionalByAjvErrors(
                { ...strictSecurityEvent },
                validateFunc.errors
              );

              // Create after strip artifact
              const afterStripPath = path.join(
                path.dirname(this.episodesDir),
                'security_event_episode_after_strip.json'
              );
              await fs.writeJson(afterStripPath, strippedEvent, { spaces: 2 });

              // Validate the stripped event
              const finalValidation = await validate(
                'ds.security_event_episode_core_v1',
                strippedEvent
              );

              if (!finalValidation.ok) {
                // If still not valid, create error report with detailed AJV errors
                const detailedErrors = validateFunc.errors.map((error: ErrorObject) => ({
                  instancePath: error.instancePath,
                  schemaPath: error.schemaPath,
                  keyword: error.keyword,
                  params: error.params,
                  message: error.message,
                }));

                // Create additional properties summary
                const additionalPropsSummary = this.createAdditionalPropertiesSummary(
                  validateFunc.errors
                );
                additionalPropsSummary.episode_id = strippedEvent.episode_id; // Add episode_id to summary
                const summaryPath = path.join(
                  path.dirname(this.episodesDir),
                  'security_event_additional_properties_summary.json'
                );
                await fs.writeJson(summaryPath, additionalPropsSummary, { spaces: 2 });

                // Create validation error report
                const validationErrorReport = {
                  timestamp: new Date().toISOString(),
                  episode_id: strippedEvent.episode_id,
                  errors: detailedErrors,
                };

                const diagDir = path.dirname(this.episodesDir);
                const errorReportPath = path.join(diagDir, 'security_event_validation_errors.json');
                const episodeDumpPath = path.join(diagDir, 'security_event_episode_dump.json');

                await fs.ensureDir(diagDir);
                await fs.writeJson(errorReportPath, validationErrorReport, { spaces: 2 });
                await fs.writeJson(episodeDumpPath, strippedEvent, { spaces: 2 });

                logger.info(`Saved: ${errorReportPath}`);
                logger.info(`Saved: ${episodeDumpPath}`);
                logger.info(`Saved: ${summaryPath}`);
                logger.info(`Saved: ${beforeStripPath}`);
                logger.info(`Saved: ${afterStripPath}`);
              } else {
                // Successfully stripped, use the cleaned event
                sanitizedSecurityEvent = strippedEvent;
              }
            } else {
              // No additional properties errors, but still invalid - report as before
              const detailedErrors = validateFunc.errors.map((error: ErrorObject) => ({
                instancePath: error.instancePath,
                schemaPath: error.schemaPath,
                keyword: error.keyword,
                params: error.params,
                message: error.message,
              }));

              // Create validation error report
              const validationErrorReport = {
                timestamp: new Date().toISOString(),
                episode_id: strictSecurityEvent.episode_id,
                errors: detailedErrors,
              };

              const diagDir = path.dirname(this.episodesDir);
              const errorReportPath = path.join(diagDir, 'security_event_validation_errors.json');
              const episodeDumpPath = path.join(diagDir, 'security_event_episode_dump.json');

              await fs.ensureDir(diagDir);
              await fs.writeJson(errorReportPath, validationErrorReport, { spaces: 2 });
              await fs.writeJson(episodeDumpPath, strictSecurityEvent, { spaces: 2 });

              logger.info(`Saved: ${errorReportPath}`);
              logger.info(`Saved: ${episodeDumpPath}`);
            }
          }
        } else {
          // Fallback: save the original validation errors
          const validationErrorReport = {
            timestamp: new Date().toISOString(),
            episode_id: strictSecurityEvent.episode_id,
            errors: validation.errors,
          };

          const diagDir = path.dirname(this.episodesDir);
          const errorReportPath = path.join(diagDir, 'security_event_validation_errors.json');
          const episodeDumpPath = path.join(diagDir, 'security_event_episode_dump.json');

          await fs.ensureDir(diagDir);
          await fs.writeJson(errorReportPath, validationErrorReport, { spaces: 2 });
          await fs.writeJson(episodeDumpPath, strictSecurityEvent, { spaces: 2 });

          logger.info(`Saved: ${errorReportPath}`);
          logger.info(`Saved: ${episodeDumpPath}`);
        }
      } else {
        // Other validation errors (not additional properties), save as before
        const ajvInstance = ajvLoader.getAjv;
        const validateFunc = ajvInstance.getSchema('ds.security_event_episode_core_v1');

        if (validateFunc) {
          const isValid = validateFunc(strictSecurityEvent);

          if (!isValid && validateFunc.errors) {
            const detailedErrors = validateFunc.errors.map((error: ErrorObject) => ({
              instancePath: error.instancePath,
              schemaPath: error.schemaPath,
              keyword: error.keyword,
              params: error.params,
              message: error.message,
            }));

            // Create validation error report
            const validationErrorReport = {
              timestamp: new Date().toISOString(),
              episode_id: strictSecurityEvent.episode_id,
              errors: detailedErrors,
            };

            const diagDir = path.dirname(this.episodesDir);
            const errorReportPath = path.join(diagDir, 'security_event_validation_errors.json');
            const episodeDumpPath = path.join(diagDir, 'security_event_episode_dump.json');

            await fs.ensureDir(diagDir);
            await fs.writeJson(errorReportPath, validationErrorReport, { spaces: 2 });
            await fs.writeJson(episodeDumpPath, strictSecurityEvent, { spaces: 2 });

            logger.info(`Saved: ${errorReportPath}`);
            logger.info(`Saved: ${episodeDumpPath}`);
          }
        }
      }
    } else {
      // Validation passed, use the event as is
      sanitizedSecurityEvent = strictSecurityEvent;
    }

    const eventFilePath = path.join(this.episodesDir, `${eventId}.json`);
    await fs.writeJson(eventFilePath, sanitizedSecurityEvent, { spaces: 2 });

    // Append to index
    await this.appendToIndex(eventId, sanitizedSecurityEvent);

    return eventId;
  }

  /**
   * Strip additional properties based on AJV errors
   */
  private async stripAdditionalByAjvErrors(obj: any, errors: ErrorObject[]): Promise<any> {
    let result = JSON.parse(JSON.stringify(obj)); // Deep copy to avoid mutation issues
    let iteration = 0;
    const maxIterations = 10;

    while (iteration < maxIterations) {
      // Find additionalProperties errors
      const additionalErrors = errors.filter(
        (error: ErrorObject) => error && error.keyword === 'additionalProperties'
      );

      if (additionalErrors.length === 0) {
        break; // No more additional properties errors
      }

      // Process each additional property error
      // Keep a set of top-level fields that must not be removed
      const keepTopLevel = new Set([
        'episode_id',
        'episode_type',
        'mova_version',
        'recorded_at',
        'executor',
        'result_status',
        'result_summary',
        'security_event_type',
        'security_event_category',
        'severity',
        'security_model_version',
        'input_envelopes',
        'input_data_refs',
      ]);

      for (const error of additionalErrors) {
        if (!error) continue;

        const instancePath = error.instancePath || '';
        const additionalProperty = error.params?.additionalProperty;

        if (additionalProperty) {
          // Navigate to the parent object using instancePath
          let parent = result;
          const pathParts = instancePath
            .replace(/^\//, '')
            .split('/')
            .filter((part: string) => part !== '');

          for (const part of pathParts) {
            if (parent && typeof parent === 'object' && parent[part] !== undefined) {
              parent = parent[part];
            } else {
              break; // Can't navigate further
            }
          }

          // Avoid deleting crucial top-level fields
          if (instancePath === '' && keepTopLevel.has(additionalProperty)) {
            continue;
          }

          // Remove the additional property from the parent (if present)
          if (parent && typeof parent === 'object' && additionalProperty in parent) {
            // Move removed property into meta_episode to preserve data
            if (instancePath === '' && parent && typeof parent === 'object') {
              if (!parent.meta_episode || typeof parent.meta_episode !== 'object')
                parent.meta_episode = {};
              parent.meta_episode[additionalProperty] = parent[additionalProperty];
            }
            delete parent[additionalProperty];
          }
        }
      }

      // Re-validate to see if there are still errors
      const validation = await validate('ds.security_event_episode_core_v1', result);
      if (validation.ok) {
        break; // Successfully validated
      }

      // Get new errors for next iteration
      const ajvInstance = ajvLoader.getAjv;
      const validateFunc = ajvInstance.getSchema('ds.security_event_episode_core_v1');

      if (validateFunc) {
        const isValid = validateFunc(result);
        if (!isValid && validateFunc.errors) {
          errors = validateFunc.errors;
        } else {
          break; // No more errors or can't get them
        }
      } else {
        break; // Can't validate further
      }

      iteration++;
    }

    return result;
  }

  /**
   * Create a summary of additional properties errors
   */
  private createAdditionalPropertiesSummary(errors: ErrorObject[]): any {
    const additionalErrors = errors.filter(
      (error: ErrorObject) => error && error.keyword === 'additionalProperties'
    );

    const summary: any = {
      episode_id: '', // Will be filled later
      additional: [],
    };

    const propMap: any = {};

    for (const error of additionalErrors) {
      const instancePath = error.instancePath;
      const additionalProperty =
        error.params?.additionalProperty ||
        error.message?.match(/property '(.+)'|'(.+)'|(.+)/)?.[1] ||
        error.message?.match(/property '(.+)'|'(.+)'|(.+)/)?.[2] ||
        error.message?.match(/property '(.+)'|'(.+)'|(.+)/)?.[3];

      if (additionalProperty) {
        const key = `${instancePath}_${additionalProperty}`;
        if (!propMap[key]) {
          propMap[key] = {
            instancePath,
            additionalProperty,
            count: 0,
          };
        }
        propMap[key].count++;
      }
    }

    summary.additional = Object.values(propMap);
    return summary;
  }

  /**
   * Adds an entry to the index file - this should be a full MOVA 4.1.1 compliant episode
   */
  private async appendToIndex(episodeId: string, episode: any): Promise<void> {
    const indexPath = path.join(this.episodesDir, 'index.jsonl');

    // Write the full MOVA 4.1.1 compliant episode object in JSONL format (one JSON object per line)
    const jsonLine = JSON.stringify(episode) + '\n';
    await fs.ensureDir(path.dirname(indexPath));
    await fs.appendFile(indexPath, jsonLine);
  }
}

export { EpisodeWriter, RunEpisodeWriter, MovaEpisode, SecurityEventEpisode };
