/**
 * Phase 5: Skills (planner/repair/explain)
 *
 * This phase implements the skills layer that provides higher-level
 * capabilities built on top of the core interpreter.
 */

// planner/planner.ts
// Используем any для краткосрочного решения, так как типы требуют адаптации
// Позже можно будет определить правильные интерфейсы

interface PlanningRequest {
  goal: string;
  constraints?: any;
  available_tools?: string[];
  context?: any;
}

interface PlanningResponse {
  plan: any;
  confidence: number;
  reasoning: string;
}

class Planner {
  /**
   * Creates a plan based on a goal and available resources
   */
  async createPlan(request: PlanningRequest): Promise<PlanningResponse> {
    // This is a simplified planner that creates a basic plan
    // In a real implementation, this would use more sophisticated planning algorithms

    const plan: any = {
      id: `plan_${Date.now()}`,
      payload: {
        steps: [],
      },
      signature: null,
    };

    // More comprehensive pattern matching
    const lowerGoal = request.goal.toLowerCase();

    if (
      lowerGoal.includes('get data from api') ||
      lowerGoal.includes('fetch from api') ||
      lowerGoal.includes('retrieve from api')
    ) {
      plan.payload.steps = [
        {
          id: 'fetch-data',
          verb: 'http',
          connector_id: 'http_connector_1',
          input: {
            url: 'https://api.example.com/data',
            method: 'GET',
          },
          tool_binding: {
            driver_kind: 'http',
            destination_allowlist: ['https://api.example.com'],
            limits: {
              timeout_ms: 5000,
              max_data_size: 102400,
            },
          },
        },
        {
          id: 'parse-response',
          verb: 'noop',
          connector_id: 'noop_connector_1',
          input: {
            raw_response: '{{outputs.fetch-data}}',
          },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 1000,
              max_data_size: 10240,
            },
          },
        },
      ];
    } else if (lowerGoal.includes('process data') || lowerGoal.includes('transform data')) {
      plan.payload.steps = [
        {
          id: 'load-data',
          verb: 'noop',
          connector_id: 'noop_connector_1',
          input: {
            source: 'input_data',
          },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 1000,
              max_data_size: 10240,
            },
          },
        },
        {
          id: 'transform-data',
          verb: 'noop',
          connector_id: 'noop_connector_2',
          input: {
            data: '{{outputs.load-data}}',
            transformation: 'uppercase',
          },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 2000,
              max_data_size: 10240,
            },
          },
        },
        {
          id: 'save-result',
          verb: 'noop',
          connector_id: 'noop_connector_3',
          input: {
            data: '{{outputs.transform-data}}',
            destination: 'output_location',
          },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 1000,
              max_data_size: 10240,
            },
          },
        },
      ];
    } else if (lowerGoal.includes('weather') || lowerGoal.includes('temperature')) {
      plan.payload.steps = [
        {
          id: 'fetch-weather',
          verb: 'http',
          connector_id: 'http_connector_1',
          input: {
            url: 'https://api.weather.com/v1/current',
            method: 'GET',
            headers: {
              Authorization: 'Bearer {{API_KEY}}',
            },
          },
          tool_binding: {
            driver_kind: 'http',
            destination_allowlist: ['https://api.weather.com'],
            limits: {
              timeout_ms: 5000,
              max_data_size: 102400,
            },
          },
        },
        {
          id: 'extract-temperature',
          verb: 'noop',
          connector_id: 'noop_connector_1',
          input: {
            weather_data: '{{outputs.fetch-weather}}',
            path: '$.current.temperature',
          },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 1000,
              max_data_size: 10240,
            },
          },
        },
        {
          id: 'store-temperature',
          verb: 'noop',
          connector_id: 'noop_connector_2',
          input: {
            temperature: '{{outputs.extract-temperature}}',
            storage_key: 'current_temperature',
          },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 1000,
              max_data_size: 10240,
            },
          },
        },
      ];
    } else {
      // Default plan with basic noop operations
      plan.payload.steps = [
        {
          id: 'default-action',
          verb: 'noop',
          connector_id: 'noop_connector_1',
          input: {
            message: `Processing request: ${request.goal}`,
          },
          tool_binding: {
            driver_kind: 'noop',
            limits: {
              timeout_ms: 1000,
              max_data_size: 10240,
            },
          },
        },
      ];
    }

    return {
      plan,
      confidence: 0.8,
      reasoning: 'Pattern matching used to generate appropriate plan',
    };
  }
}

// repair/repair_service.ts
interface RepairRequest {
  failed_plan: any;
  failure_context: any;
  error_details: string;
  recovery_strategy?: 'retry' | 'fallback' | 'manual';
}

interface RepairResponse {
  repaired_plan: any;
  success_probability: number;
  recommended_actions: string[];
}

class RepairService {
  /**
   * Attempts to repair a failed plan by identifying and correcting issues
   */
  async repairPlan(request: RepairRequest): Promise<RepairResponse> {
    const repairedPlan = JSON.parse(JSON.stringify(request.failed_plan)); // Deep copy

    // Example repair strategies
    const recommendedActions: string[] = [];

    // If the error mentions timeout, increase timeout in binding
    if (request.error_details.toLowerCase().includes('timeout')) {
      for (const step of repairedPlan.payload.steps) {
        if (step.tool_binding && step.tool_binding.limits) {
          // Increase timeout by 50%
          step.tool_binding.limits.timeout_ms = Math.round(
            step.tool_binding.limits.timeout_ms * 1.5
          );
        }
      }
      recommendedActions.push('Increased timeout limits for steps');
    }

    // If the error mentions invalid destination, check for allowlist issues
    if (request.error_details.toLowerCase().includes('destination not allowlisted')) {
      // This would typically involve adding the destination to allowlist
      // after appropriate checks, but for safety, we'll recommend manual review
      recommendedActions.push(
        'Destination allowlist issue detected - requires manual verification'
      );
    }

    return {
      repaired_plan: repairedPlan,
      success_probability: 0.7,
      recommended_actions: recommendedActions,
    };
  }
}

// explain/explanation_service.ts
interface ExplanationRequest {
  plan: any;
  query: string; // e.g., "Why did this step fail?", "What does this plan do?"
  execution_context?: any;
  execution_results?: any;
}

interface ExplanationResponse {
  explanation: string;
  supporting_facts: string[];
  confidence: number;
}

interface Episode {
  id: string;
  request: string;
  plan?: any;
}

interface Evidence {
  id: string;
  type: string;
  summary: string;
  related_episode_id?: string;
  related_step_id?: string;
}

interface ExplanationResult {
  explanation: string;
  confidence: number;
  supporting_facts: Array<{
    id: string;
    type: string;
    summary: string;
  }>;
}

class ExplanationService {
  /**
   * Provides explanations about plans, executions, and their results
   */
  async explain(request: ExplanationRequest): Promise<ExplanationResponse> {
    let explanation = '';
    const facts: string[] = [];

    if (
      request.query.toLowerCase().includes('fail') ||
      request.query.toLowerCase().includes('error')
    ) {
      // Explain why a step might have failed
      if (request.execution_results) {
        const error = request.execution_results.error || request.execution_results.message;

        if (error && error.toLowerCase().includes('timeout')) {
          explanation =
            'The operation failed due to a timeout. The request took longer than the allowed time limit.';
          facts.push('Failure cause: Timeout exceeded');
          facts.push('Recommendation: Increase timeout limits or optimize the operation');
        } else if (
          error &&
          (error.toLowerCase().includes('forbidden') || error.toLowerCase().includes('denied'))
        ) {
          explanation =
            'The operation failed due to security policy violation. The requested action is not allowed by the current security configuration.';
          facts.push('Failure cause: Security policy violation');
          facts.push('Recommendation: Check allowlists and permissions');
        } else if (
          error &&
          (error.toLowerCase().includes('not found') || error.toLowerCase().includes('404'))
        ) {
          explanation = 'The operation failed because the requested resource was not found.';
          facts.push('Failure cause: Resource not found');
          facts.push('Recommendation: Verify the resource identifier or availability');
        } else {
          explanation = `The operation failed with an error: ${error || 'Unknown error occurred'}`;
          facts.push(`Error details: ${error || 'No specific error details'}`);
        }
      } else {
        explanation =
          'The failure appears to be related to policy violations or resource constraints during execution.';
        facts.push('Possible causes: Security policies, resource limits, or unavailable resources');
      }
    } else if (
      request.query.toLowerCase().includes('do') ||
      request.query.toLowerCase().includes('purpose') ||
      request.query.toLowerCase().includes('what')
    ) {
      // Explain what the plan does
      explanation = 'This plan executes a sequence of steps to achieve the specified goal. ';

      if (request.plan && request.plan.payload && request.plan.payload.steps) {
        const steps = request.plan.payload.steps;
        explanation += `It includes ${steps.length} steps: `;

        const verbs = steps
          .map((step: any) => step.verb || 'unknown')
          .filter((v: any) => v !== 'unknown');
        explanation += verbs.join(', ') + '.';

        facts.push(`Plan has ${steps.length} steps`);
        facts.push(`Operations: ${verbs.join(', ')}`);

        // Additional details about steps
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (step.input) {
            facts.push(`Step ${i + 1} (${step.verb}): processes input data`);
          }
          if (step.tool_binding && step.tool_binding.driver_kind) {
            facts.push(`Step ${i + 1}: uses ${step.tool_binding.driver_kind} driver`);
          }
          if (step.tool_binding && step.tool_binding.destination_allowlist) {
            facts.push(
              `Step ${i + 1}: restricted to destinations: ${step.tool_binding.destination_allowlist.join(', ')}`
            );
          }
        }

        // Security aspects
        if (
          steps.some((step: any) => step.tool_binding && step.tool_binding.destination_allowlist)
        ) {
          facts.push('Security: Destination allowlists applied to restrict network access');
        }
      } else {
        explanation += 'The plan structure is not available or invalid.';
        facts.push('Plan structure: Invalid or unavailable');
      }
    } else if (
      request.query.toLowerCase().includes('security') ||
      request.query.toLowerCase().includes('safe')
    ) {
      explanation =
        'This system follows strict security policies with a deny-by-default approach. All operations are validated against security rules before execution.';
      facts.push('Security model: Deny-by-default');
      facts.push('All HTTP requests require destination allowlists');
      facts.push('Resource limits enforced: timeouts and data sizes');
      facts.push('Sensitive data is automatically redacted');
    } else {
      // Generic explanation
      explanation =
        'This system processes requests through a series of validated steps, ensuring security and compliance at each stage.';
      facts.push('System type: Deterministic interpreter (not LLM-based)');
      facts.push('Security: Enforced policies with allowlist approach');
      facts.push('Processing: Sequential step execution with validation');
    }

    return {
      explanation,
      supporting_facts: facts,
      confidence: 0.9,
    };
  }

  /**
   * Provides explanations about episodes and their evidence
   */
  async explainEpisode(episode: Episode, evidence: Evidence[]): Promise<ExplanationResult> {
    // This is a more comprehensive explanation service
    // Analyze the episode and evidence to provide detailed explanations

    const stepsCount = episode.plan?.payload?.steps ? episode.plan.payload.steps.length : 0;
    const evidenceTypes = [...new Set(evidence.map((e) => e.type))];
    const errorEvidence = evidence.filter((e) => e.type.includes('error'));

    let explanation = `Episode ${episode.id} was processed with ${evidence.length} pieces of evidence of types: [${evidenceTypes.join(', ')}].\n`;

    explanation += `The request was: "${episode.request}". `;
    explanation += `The plan contained ${stepsCount} steps. `;

    if (errorEvidence.length > 0) {
      explanation += `There were ${errorEvidence.length} error evidences indicating potential issues. `;
    } else {
      explanation += `No errors were detected during processing. `;
    }

    // Add information about the plan execution
    if (episode.plan && episode.plan.payload && episode.plan.payload.steps) {
      const successfulSteps = episode.plan.payload.steps.filter((step: any) =>
        evidence.some((e) => e.related_step_id === step.id && !e.type.includes('error'))
      ).length;

      explanation += `Successfully executed ${successfulSteps}/${stepsCount} steps. `;
    }

    // Add security-related information
    const policyChecks = evidence.filter((e) => e.type === 'security.policy_check');
    if (policyChecks.length > 0) {
      explanation += `Security policy was checked ${policyChecks.length} times during execution. `;
    }

    // Add dry-run information
    const dryRunEvidence = evidence.filter((e) => e.type === 'execution.dry_run_marker');
    if (dryRunEvidence.length > 0) {
      explanation += 'Execution was performed in dry-run mode. ';
    }

    return {
      explanation,
      confidence: 0.85,
      supporting_facts: evidence.map((e) => ({
        id: e.id,
        type: e.type,
        summary: e.summary,
      })),
    };
  }
}

// skills/skills_layer.ts - Main skills interface
class SkillsLayer {
  private planner: Planner;
  private repairService: RepairService;
  private explanationService: ExplanationService;

  constructor() {
    this.planner = new Planner();
    this.repairService = new RepairService();
    this.explanationService = new ExplanationService();
  }

  /**
   * Entry point for skill-based operations
   */
  async executeSkill(skill: 'plan' | 'repair' | 'explain', params: any): Promise<any> {
    switch (skill) {
      case 'plan':
        return await this.planner.createPlan(params as PlanningRequest);
      case 'repair':
        return await this.repairService.repairPlan(params as RepairRequest);
      case 'explain':
        return await this.explanationService.explain(params as ExplanationRequest);
      default:
        throw new Error(`Unknown skill: ${skill}`);
    }
  }
}

export { SkillsLayer, Planner, RepairService, ExplanationService };
