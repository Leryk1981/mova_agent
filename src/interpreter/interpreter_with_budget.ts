/**
 * Основной интерпретатор планов MOVA Agent с интеграцией системы бюджета токенов
 */

import { validate, ajvLoader } from '../ajv/ajv_loader';
import { SchemaRegistry } from '../ajv/schema_registry';
import { HandlerRegistry } from '../handlers/registry';
import { EvidenceWriter } from '../evidence/evidence_writer';
import { EpisodeWriter, RunEpisodeWriter, SecurityEventEpisode } from '../episodes/episode_writer';
import { PolicyEngine, ToolPool, InstructionProfile } from '../policy/policy_engine';
import { randomUUID } from 'crypto';
import { TokenMeter } from '../telemetry/token_meter';
import { TokenBudgetEnforcer } from '../telemetry/token_budget_enforcer';
import { TokenBudgetLoader } from '../telemetry/token_budget_loader';
import { getLogger } from '../logging/logger';

// Типы для данных
interface SecurityEvent {
  event_type: string;
  details: any;
  severity: string;
  timestamp: string;
}

interface PlanStep {
  id: string;
  verb: string;
  connector_id: string;
  input?: any;
  input_from?: {
    step_id: string;
    path?: string;
  };
  expected_output_schema_ref?: string;
  on_error?: 'fatal' | 'soft';
}

interface PlanEnvelope {
  verb: string;
  subject_ref: string;
  object_ref: string;
  payload: {
    steps: PlanStep[];
    tool_pool_ref?: string;
    instruction_profile_ref?: string;
    model_instruction?: any;
  };
}

interface RunContext {
  run_id: string;
  request_id: string;
  evidence_dir: string;
  instructionProfile?: InstructionProfile;
  caps?: any;
  redaction_rules?: string[];
  step_inputs: Map<string, any>;
  step_outputs: Map<string, any>;
  step_bindings: Map<string, any>;
  current_step_index: number;
  step_security_events: SecurityEvent[];
  has_fatal_security_event: boolean; // Track if there was a fatal security event
  episodeWriter: RunEpisodeWriter; // Updated to use run-specific episode writer
  tokenMeter: TokenMeter;
  tokenBudgetEnforcer: TokenBudgetEnforcer;
  budgetStatus: 'passed' | 'warned' | 'failed';
  budgetViolations: any[];
  isQualitySuite?: boolean; // Flag to indicate if this is a quality suite run
}

interface ExecutionResult {
  success: boolean;
  run_summary?: any;
  error?: string;
}

/**
 * Основной интерпретатор планов MOVA Agent
 */
class Interpreter {
  private evidenceWriter: EvidenceWriter;
  private episodeWriter: EpisodeWriter; // Base episode writer
  private policyEngine: PolicyEngine;
  private tokenBudgetLoader: TokenBudgetLoader;
  private schemaInitializationPromise: Promise<void>;

  constructor() {
    this.evidenceWriter = new EvidenceWriter();
    this.episodeWriter = new EpisodeWriter();
    this.policyEngine = new PolicyEngine();
    this.tokenBudgetLoader = new TokenBudgetLoader();

    // Initialize schemas and track the promise
    this.schemaInitializationPromise = this.initializeSchemas();
  }

  /**
   * Wait for the interpreter to be fully initialized with all schemas
   */
  async ready(): Promise<void> {
    await this.schemaInitializationPromise;
  }

  private async initializeSchemas(): Promise<void> {
    try {
      const registry = new SchemaRegistry(ajvLoader);
      await registry.loadAllSchemas(); // Load both MOVA and local schemas
    } catch (error: any) {
      getLogger().info(`Warning: Could not initialize schema registry: ${error.message}`);
    }
  }

  /**
   * Основной метод запуска выполнения плана
   */
  async runPlan(params: {
    requestEnvelope?: any;
    planEnvelope: PlanEnvelope;
    toolPool: ToolPool;
    instructionProfile: InstructionProfile;
    tokenBudgetPath?: string;
  }): Promise<ExecutionResult> {
    // Wait for schema initialization to complete
    await this.ready();

    const { planEnvelope, toolPool, instructionProfile, tokenBudgetPath } = params;

    try {
      // Load token budget contract
      const tokenBudgetContract = await this.tokenBudgetLoader.load(tokenBudgetPath);

      // Set tool pool and instruction profile in policy engine for enforcement
      this.policyEngine.setToolPool(toolPool);
      this.policyEngine.setInstructionProfile(instructionProfile);

      // 1) Ajv validate plan envelope
      const planValidation = await validate('env.mova_agent_plan_v1', planEnvelope);
      if (!planValidation.ok) {
        const error = `Plan validation failed: ${planValidation.errors?.join(', ')}`;
        await this.recordSecurityEvent('validation_failed', { error, planEnvelope });
        return { success: false, error };
      }

      // 2) Ajv validate tool pool
      // Note: Since we don't have a specific schema for the full tool pool structure yet,
      // we'll validate individual tools as we encounter them
      if (!toolPool || !toolPool.tools || !Array.isArray(toolPool.tools)) {
        const error = 'Invalid tool pool structure';
        await this.recordSecurityEvent('validation_failed', { error, toolPool });
        return { success: false, error };
      }

      // 3) Validate instruction profile with deny-by-default policy
      const profileValidation = this.validateInstructionProfile(instructionProfile);
      if (!profileValidation.ok) {
        const error = `Instruction profile validation failed: ${profileValidation.errors?.join(', ')}`;
        await this.recordSecurityEvent('validation_failed', { error, instructionProfile });
        return { success: false, error };
      }

      // 4) Build an execution context
      const runId = `run_${randomUUID()}`;
      const requestId = `req_${randomUUID()}`;
      const evidenceDir = await this.evidenceWriter.createRunDirectory(requestId, runId);

      // Create run-specific episode writer
      const runEpisodeWriter = this.episodeWriter.createRunWriter(requestId, runId);

      // Initialize token meter and budget enforcer
      const tokenMeter = new TokenMeter(evidenceDir);
      const tokenBudgetEnforcer = new TokenBudgetEnforcer(tokenBudgetContract, tokenMeter);

      // Save the resolved token budget contract
      this.tokenBudgetLoader.saveResolvedContract(tokenBudgetContract, evidenceDir);

      const context: RunContext = {
        run_id: runId,
        request_id: requestId,
        evidence_dir: evidenceDir,
        instructionProfile: instructionProfile,
        caps: instructionProfile.caps,
        redaction_rules: instructionProfile.redaction_rules,
        step_inputs: new Map(),
        step_outputs: new Map(),
        step_bindings: new Map(),
        current_step_index: 0,
        step_security_events: [],
        has_fatal_security_event: false,
        episodeWriter: runEpisodeWriter,
        tokenMeter,
        tokenBudgetEnforcer,
        budgetStatus: 'passed',
        budgetViolations: [],
      };

      // Write initial artifacts
      await this.evidenceWriter.writeArtifact(
        evidenceDir,
        'request.envelope.json',
        params.requestEnvelope || {}
      );
      await this.evidenceWriter.writeArtifact(evidenceDir, 'plan.envelope.json', planEnvelope);
      await this.evidenceWriter.writeArtifact(evidenceDir, 'tool_pool.resolved.json', toolPool);
      await this.evidenceWriter.writeArtifact(
        evidenceDir,
        'instruction_profile.resolved.json',
        instructionProfile
      );

      // 5) Execute steps in order
      let executionError: string | undefined;
      for (const step of planEnvelope.payload.steps) {
        // Check if we can execute this step based on token budget
        const budgetStatus = context.tokenBudgetEnforcer.checkModelCall();
        if (budgetStatus.exceeded) {
          // Handle budget violation
          context.budgetStatus = budgetStatus.action === 'fail' ? 'failed' : 'warned';
          context.budgetViolations.push(...budgetStatus.violations);

          if (budgetStatus.action === 'fail') {
            executionError = `Budget exceeded: ${budgetStatus.violations.map((v) => v.message).join('; ')}`;
            break;
          } else if (budgetStatus.action === 'warn') {
            getLogger().info(
              `Budget warning: ${budgetStatus.violations.map((v) => v.message).join('; ')}`
            );
          }
        }

        const stepResult = await this.executeStep(step, context, toolPool);

        if (!stepResult.success && step.on_error !== 'soft') {
          // Step failed and is marked as fatal
          executionError = `Step ${step.id} failed: ${stepResult.error}`;
          break; // Exit the loop on fatal error
        }

        // Store output for potential use by subsequent steps
        if (stepResult.output) {
          context.step_outputs.set(step.id, stepResult.output);
        }
      }

      // 6) Emit final run summary episode and return structured result
      // Check if there were any fatal security events or execution errors
      const finalStatus =
        context.has_fatal_security_event || executionError ? 'failed' : 'completed';
      const finalError = context.has_fatal_security_event
        ? 'Fatal security event occurred during execution'
        : executionError;
      const runSummary = await this.createRunSummary(context, finalStatus, finalError);
      await this.evidenceWriter.writeArtifact(evidenceDir, 'run_summary.json', runSummary);

      // Create a final execution episode for the overall run
      await context.episodeWriter.writeExecutionEpisode({
        episode_type: 'execution_run_summary',
        result_status: finalStatus,
        result_summary: finalError ? `Run failed: ${finalError}` : 'Run completed successfully',
        input_data_refs: [
          {
            data_type: 'ds.mova_agent_plan_v1',
            data_id:
              planEnvelope.payload.steps.length > 0 ? planEnvelope.payload.steps[0].id : 'unknown',
          },
        ],
        payload: {
          run_id: context.run_id,
          request_id: context.request_id,
          total_steps: planEnvelope.payload.steps.length,
          steps_completed: context.step_outputs.size,
          status: finalStatus,
          error: finalError,
        },
      });

      return {
        success: !context.has_fatal_security_event && !executionError,
        run_summary: runSummary,
      };
    } catch (error: any) {
      const errorMessage = `Unexpected error during plan execution: ${error.message}`;
      // We don't have context here, so we'll call without it
      await this.recordSecurityEvent('execution_error', {
        error: errorMessage,
        stack: error.stack,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Выполнить один шаг плана
   */
  private async executeStep(
    step: PlanStep,
    context: RunContext,
    toolPool: ToolPool
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    try {
      // a) Resolve input
      let input = step.input;
      if (step.input_from) {
        const referencedStepId = step.input_from.step_id;
        if (!context.step_outputs.has(referencedStepId)) {
          throw new Error(`Input references non-existent step: ${referencedStepId}`);
        }

        const referencedOutput = context.step_outputs.get(referencedStepId);
        if (step.input_from.path) {
          // Simple path resolution - in a real implementation this would be more sophisticated
          input = this.resolvePath(referencedOutput, step.input_from.path);
        } else {
          input = referencedOutput;
        }
      }

      // b) Validate input schema (if provided)
      if (step.expected_output_schema_ref && input) {
        const inputValidation = await validate(step.expected_output_schema_ref, input);
        if (!inputValidation.ok) {
          const error = `Step input validation failed: ${inputValidation.errors?.join(', ')}`;

          // Emit failure episode using MOVA 4.1.1 format
          await context.episodeWriter.writeExecutionEpisode({
            episode_type: 'execution_step',
            result_status: 'failed',
            result_summary: `Step ${step.id} failed: ${error}`,
            input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
            payload: {
              step_id: step.id,
              error: error,
              status: 'failed',
            },
          });

          await this.recordSecurityEvent(
            'input_validation_failed',
            { step_id: step.id, error, input },
            context
          );
          return { success: false, error };
        }
      }

      // c) Policy checks using the policy engine
      const tool = toolPool.tools.find((t) => t.id === step.connector_id);
      if (!tool) {
        const error = `Tool not found in pool: ${step.connector_id}`;

        // Emit failure episode using MOVA 4.1.1 format
        await context.episodeWriter.writeExecutionEpisode({
          episode_type: 'execution_step',
          result_status: 'failed',
          result_summary: `Step ${step.id} failed: ${error}`,
          input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
          payload: {
            step_id: step.id,
            error: error,
            status: 'failed',
          },
        });

        await this.recordSecurityEvent(
          'tool_not_allowlisted',
          { step_id: step.id, error, connector_id: step.connector_id },
          context
        );
        return { success: false, error };
      }

      // Perform comprehensive policy check
      const policyEvaluation = this.policyEngine.evaluateStepComprehensive({
        id: step.id,
        verb: step.verb,
        connector_id: step.connector_id,
        input: input,
        tool_binding: tool.binding,
      });

      if (!policyEvaluation.allowed) {
        const error = `Step failed policy evaluation: ${policyEvaluation.reason}`;

        // Emit failure episode using MOVA 4.1.1 format
        await context.episodeWriter.writeExecutionEpisode({
          episode_type: 'execution_step',
          result_status: 'failed',
          result_summary: `Step ${step.id} failed: ${error}`,
          input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
          payload: {
            step_id: step.id,
            error: error,
            status: 'failed',
          },
        });

        await this.recordSecurityEvent(
          'policy_check_failed',
          {
            step_id: step.id,
            error,
            policy_reason: policyEvaluation.reason,
            input,
            binding: tool.binding,
          },
          context
        );
        return { success: false, error };
      }

      // Additional specific checks for destinations
      if (input && (input.url || input.endpoint)) {
        const destUrl = input.url || input.endpoint;
        const allowlist = tool.binding.destination_allowlist;

        if (allowlist && allowlist.length > 0) {
          const isAllowed = allowlist.some((allowed: string) => {
            try {
              const inputUrl = new URL(destUrl);
              const allowedUrl = new URL(allowed);
              return (
                inputUrl.hostname === allowedUrl.hostname &&
                inputUrl.protocol === allowedUrl.protocol &&
                (inputUrl.port === allowedUrl.port || allowedUrl.port === '')
              );
            } catch {
              return false; // If we can't parse the URL, consider it not allowed
            }
          });

          if (!isAllowed) {
            const error = `Destination not allowlisted: ${destUrl}`;

            // Emit failure episode using MOVA 4.1.1 format
            await context.episodeWriter.writeExecutionEpisode({
              episode_type: 'execution_step',
              result_status: 'failed',
              result_summary: `Step ${step.id} failed: ${error}`,
              input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
              payload: {
                step_id: step.id,
                error: error,
                status: 'failed',
              },
            });

            await this.recordSecurityEvent(
              'destination_not_allowlisted',
              {
                step_id: step.id,
                error,
                destination: destUrl,
                allowed_destinations: allowlist,
              },
              context
            );
            return { success: false, error };
          }
        }
      }

      // Check limits are present (already checked in policy engine, but keeping as extra safeguard)
      if (!tool.binding.limits || !tool.binding.limits.timeout_ms) {
        const error = `Required limits not specified for tool: ${step.connector_id}`;

        // Emit failure episode using MOVA 4.1.1 format
        await context.episodeWriter.writeExecutionEpisode({
          episode_type: 'execution_step',
          result_status: 'failed',
          result_summary: `Step ${step.id} failed: ${error}`,
          input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
          payload: {
            step_id: step.id,
            error: error,
            status: 'failed',
          },
        });

        await this.recordSecurityEvent(
          'limits_not_specified',
          { step_id: step.id, error, connector_id: step.connector_id },
          context
        );
        return { success: false, error };
      }

      // Check tool call budget
      const toolBudgetStatus = context.tokenBudgetEnforcer.checkToolCall();
      if (toolBudgetStatus.exceeded) {
        // Handle budget violation
        context.budgetStatus = toolBudgetStatus.action === 'fail' ? 'failed' : 'warned';
        context.budgetViolations.push(...toolBudgetStatus.violations);

        if (toolBudgetStatus.action === 'fail') {
          const error = `Tool call budget exceeded: ${toolBudgetStatus.violations.map((v) => v.message).join('; ')}`;

          // Emit failure episode using MOVA 4.1.1 format
          await context.episodeWriter.writeExecutionEpisode({
            episode_type: 'execution_step',
            result_status: 'failed',
            result_summary: `Step ${step.id} failed: ${error}`,
            input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
            payload: {
              step_id: step.id,
              error: error,
              status: 'failed',
            },
          });

          return { success: false, error };
        } else if (toolBudgetStatus.action === 'warn') {
          getLogger().info(
            `Tool call budget warning: ${toolBudgetStatus.violations.map((v) => v.message).join('; ')}`
          );
        }
      }

      // d) Dispatch handler by binding.driver_kind from static registry
      const handler = HandlerRegistry.getInstance()[tool.binding.driver_kind];
      if (!handler) {
        const error = `Handler not found for driver kind: ${tool.binding.driver_kind}`;

        // Emit failure episode using MOVA 4.1.1 format
        await context.episodeWriter.writeExecutionEpisode({
          episode_type: 'execution_step',
          result_status: 'failed',
          result_summary: `Step ${step.id} failed: ${error}`,
          input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
          payload: {
            step_id: step.id,
            error: error,
            status: 'failed',
          },
        });

        await this.recordSecurityEvent(
          'handler_not_found',
          { step_id: step.id, error, driver_kind: tool.binding.driver_kind },
          context
        );
        return { success: false, error };
      }

      // e) Execute handler
      const handlerResult = await handler(input, tool, context);

      // Check tool output budget
      const outputStr = JSON.stringify(handlerResult);
      const toolOutputBudgetStatus = context.tokenBudgetEnforcer.checkToolOutput(outputStr);
      if (toolOutputBudgetStatus.exceeded) {
        // Handle budget violation
        context.budgetStatus = toolOutputBudgetStatus.action === 'fail' ? 'failed' : 'warned';
        context.budgetViolations.push(...toolOutputBudgetStatus.violations);

        if (toolOutputBudgetStatus.action === 'fail') {
          const error = `Tool output budget exceeded: ${toolOutputBudgetStatus.violations.map((v) => v.message).join('; ')}`;

          // Emit failure episode using MOVA 4.1.1 format
          await context.episodeWriter.writeExecutionEpisode({
            episode_type: 'execution_step',
            result_status: 'failed',
            result_summary: `Step ${step.id} failed: ${error}`,
            input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
            payload: {
              step_id: step.id,
              error: error,
              status: 'failed',
            },
          });

          return { success: false, error };
        } else if (toolOutputBudgetStatus.action === 'warn') {
          getLogger().info(
            `Tool output budget warning: ${toolOutputBudgetStatus.violations.map((v) => v.message).join('; ')}`
          );
        }
      }

      // Record successful tool call
      context.tokenBudgetEnforcer.recordSuccessfulToolCall(outputStr);

      // f) Validate output schema (if provided)
      if (tool.binding.schema_refs?.output && handlerResult) {
        const outputValidation = await validate(tool.binding.schema_refs.output, handlerResult);
        if (!outputValidation.ok) {
          const error = `Step output validation failed: ${outputValidation.errors?.join(', ')}`;

          // Emit failure episode using MOVA 4.1.1 format
          await context.episodeWriter.writeExecutionEpisode({
            episode_type: 'execution_step',
            result_status: 'failed',
            result_summary: `Step ${step.id} failed: ${error}`,
            input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
            payload: {
              step_id: step.id,
              error: error,
              status: 'failed',
            },
          });

          await this.recordSecurityEvent(
            'output_validation_failed',
            { step_id: step.id, error, output: handlerResult },
            context
          );
          return { success: false, error };
        }
      }

      // g) Write artifacts (inputs/outputs/logs)
      await this.evidenceWriter.writeArtifact(context.evidence_dir, `logs/${step.id}.log`, {
        input,
        output: handlerResult,
        timestamp: new Date().toISOString(),
      });

      // h) Emit episode for the step using MOVA 4.1.1 format
      await context.episodeWriter.writeExecutionEpisode({
        episode_type: 'execution_step',
        result_status: 'completed',
        result_summary: `Step ${step.id} executed successfully`,
        input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
        payload: {
          step_id: step.id,
          input,
          output: handlerResult,
          status: 'success',
        },
      });

      return { success: true, output: handlerResult };
    } catch (error: any) {
      const errorMessage = `Step execution failed: ${error.message}`;

      // Write error log
      await this.evidenceWriter.writeArtifact(context.evidence_dir, `logs/${step.id}.log`, {
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      // Emit failure episode using MOVA 4.1.1 format
      await context.episodeWriter.writeExecutionEpisode({
        episode_type: 'execution_step',
        result_status: 'failed',
        result_summary: `Step ${step.id} failed: ${errorMessage}`,
        input_data_refs: [{ data_type: 'ds.mova_agent_step_v1', data_id: step.id }],
        payload: {
          step_id: step.id,
          error: errorMessage,
          status: 'failed',
        },
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Простой резолвер пути для получения значения из объекта по строковому пути
   */
  private resolvePath(obj: any, path: string): any {
    return path.split('.').reduce((current, part) => current?.[part], obj);
  }

  /**
   * Записать событие безопасности
   */
  private async recordSecurityEvent(
    eventType: string,
    details: any,
    context?: RunContext
  ): Promise<void> {
    // Determine if this is a high severity event that should mark the run as failed
    const severity = this.getSecurityEventSeverity(eventType);
    const isHighSeverity = ['high', 'critical'].includes(severity);

    // If we have context, mark the run as having a fatal security event
    if (context && isHighSeverity) {
      context.has_fatal_security_event = true;
    }

    // Use the run-specific episode writer to write security events
    const runEpisodeWriter =
      context?.episodeWriter ||
      this.episodeWriter.createRunWriter(
        context?.request_id || 'unknown',
        context?.run_id || 'unknown'
      );

    // Prepare the security event object
    const securityEvent: Partial<SecurityEventEpisode> = {
      episode_type: `security_event/${eventType}`,
      security_event_type: eventType,
      security_event_category: this.getSecurityEventCategory(eventType),
      severity: severity,
      result_status: 'failed', // Security events typically represent failures
      result_summary: `Security event: ${eventType}`,
      detection_source: 'runtime_guard',
      policy_profile_id: 'mova_security_default_v1',
      security_model_version: '1.0.0',
      // Include context information in meta_episode
      meta_episode: {
        ...(context
          ? {
              request_id: context.request_id,
              run_id: context.run_id,
              evidence_dir: context.evidence_dir,
            }
          : {}),
        // Add relevant details to meta_episode if they exist in details
        ...(details && typeof details === 'object'
          ? {
              ...(details.step_id && { step_id: details.step_id }),
              ...(details.connector_id && { connector_id: details.connector_id }),
            }
          : {}),
      },
    };

    // Add remaining details to the security event payload to avoid additionalProperties errors
    if (details && typeof details === 'object') {
      const { step_id: _stepId, connector_id: _connectorId, ...remainingDetails } = details;
      if (Object.keys(remainingDetails).length > 0) {
        securityEvent.payload = { ...remainingDetails };
      }
    }

    await runEpisodeWriter.writeSecurityEvent(securityEvent);
  }

  /**
   * Определить категорию события безопасности
   */
  private getSecurityEventCategory(
    eventType: string
  ):
    | 'auth'
    | 'authorization'
    | 'policy_violation'
    | 'instruction_misuse'
    | 'data_access'
    | 'rate_limit'
    | 'config'
    | 'infrastructure'
    | 'other' {
    const categoryMap: {
      [key: string]:
        | 'auth'
        | 'authorization'
        | 'policy_violation'
        | 'instruction_misuse'
        | 'data_access'
        | 'rate_limit'
        | 'config'
        | 'infrastructure'
        | 'other';
    } = {
      validation_failed: 'policy_violation',
      tool_not_allowlisted: 'authorization',
      destination_not_allowlisted: 'authorization',
      limits_not_specified: 'config',
      input_validation_failed: 'policy_violation',
      output_validation_failed: 'policy_violation',
      handler_not_found: 'config',
      execution_error: 'infrastructure',
      timeout: 'rate_limit',
    };

    return categoryMap[eventType] || 'other';
  }

  /**
   * Определить уровень серьезности события безопасности
   */
  private getSecurityEventSeverity(
    eventType: string
  ): 'info' | 'low' | 'medium' | 'high' | 'critical' {
    const severityMap: { [key: string]: 'info' | 'low' | 'medium' | 'high' | 'critical' } = {
      validation_failed: 'high',
      tool_not_allowlisted: 'high',
      destination_not_allowlisted: 'high',
      limits_not_specified: 'medium',
      input_validation_failed: 'medium',
      output_validation_failed: 'medium',
      handler_not_found: 'high',
      execution_error: 'high',
      timeout: 'high',
    };

    return severityMap[eventType] || 'low';
  }

  /**
   * Валидация профиля инструкций с политикой deny-by-default
   */
  private validateInstructionProfile(profile: InstructionProfile): {
    ok: boolean;
    errors?: string[];
  } {
    // Проверяем, что профиль не пустой
    if (!profile) {
      return { ok: false, errors: ['Instruction profile is required'] };
    }

    // Валидация лимитов
    if (profile.caps) {
      const errors: string[] = [];

      if (profile.caps.max_timeout_ms && typeof profile.caps.max_timeout_ms !== 'number') {
        errors.push('max_timeout_ms must be a number');
      }

      if (profile.caps.max_data_size && typeof profile.caps.max_data_size !== 'number') {
        errors.push('max_data_size must be a number');
      }

      if (profile.caps.max_steps && typeof profile.caps.max_steps !== 'number') {
        errors.push('max_steps must be a number');
      }

      if (errors.length > 0) {
        return { ok: false, errors };
      }
    }

    // Проверка правил маскировки
    if (profile.redaction_rules && !Array.isArray(profile.redaction_rules)) {
      return { ok: false, errors: ['redaction_rules must be an array'] };
    }

    return { ok: true };
  }

  /**
   * Создать сводку выполнения
   */
  private async createRunSummary(
    context: RunContext,
    status: string,
    error?: string
  ): Promise<any> {
    // Save token usage report
    context.tokenMeter.saveReport();

    return {
      run_id: context.run_id,
      request_id: context.request_id,
      status,
      timestamp_start: new Date().toISOString(), // в реальности это должно быть точное время начала
      timestamp_end: new Date().toISOString(),
      steps_executed: context.step_outputs.size,
      steps_successful:
        status === 'completed' ? context.step_outputs.size : context.step_outputs.size - 1, // упрощённо
      steps_failed: status === 'failed' ? 1 : 0, // упрощённо
      total_duration_ms: 0, // в реальности нужно отслеживать время
      error_summary: error,
      token_budget: context.tokenBudgetEnforcer.getBudgetInfo(),
      token_usage: context.tokenMeter.getBriefSummary(),
      budget_status: context.budgetStatus,
      budget_violations: context.budgetViolations,
    };
  }

  /**
   * Основной метод выполнения плана
   */
  async executePlan(plan: any): Promise<any> {
    // Инициализируем контекст выполнения
    const context: RunContext = {
      run_id: randomUUID(),
      request_id: plan.request_id || randomUUID(),
      evidence_dir: 'artifacts/mova_agent/evidence',
      instructionProfile: plan.instruction_profile,
      step_inputs: new Map(),
      step_outputs: new Map(),
      step_bindings: new Map(),
      current_step_index: 0,
      step_security_events: [],
      has_fatal_security_event: false,
      episodeWriter: this.episodeWriter.createRunWriter(
        plan.request_id || randomUUID(),
        randomUUID()
      ),
      tokenMeter: new TokenMeter(),
      tokenBudgetEnforcer: null as any, // будет инициализирован позже
      budgetStatus: 'passed',
      budgetViolations: [],
    };

    try {
      // Валидация профиля инструкций
      const profileValidation = this.validateInstructionProfile(plan.instruction_profile);
      if (!profileValidation.ok) {
        throw new Error(
          `Instruction profile validation failed: ${profileValidation.errors?.join(', ')}`
        );
      }

      getLogger().info(`Starting execution for plan: ${plan.plan_id}`);

      // Создадим минимальный тулпул для тестирования
      const toolPool: ToolPool = {
        tools: [],
      };

      // Выполняем каждый шаг плана
      for (const step of plan.steps || []) {
        // Выполняем шаг
        const stepResult = await this.executeStep(step, context, toolPool);
        if (!stepResult.success) {
          getLogger().error(`Step failed: ${stepResult.error}`);
          return { success: false, error: stepResult.error };
        }
      }

      return { success: true };
    } catch (error) {
      getLogger().error(`Plan execution failed: ${error}`);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export { Interpreter };
