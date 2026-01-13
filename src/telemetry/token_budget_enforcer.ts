/**
 * Система проверки бюджета токенов для MOVA Agent
 * Проверяет лимиты и применяет политику при превышении
 */

import { TokenMeter, type TokenSummary } from './token_meter';
import { getLogger } from '../logging/logger';
import type { SecurityEventEpisode } from '../episodes/episode_writer';

interface TokenBudgetLimits {
  max_model_calls?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_total_tokens?: number;
  max_output_tokens_per_call?: number;
  max_total_cost_usd?: number;
  max_tool_calls?: number;
  max_tool_output_bytes_total?: number;
  max_stdout_bytes?: number;
  max_stderr_bytes?: number;
}

interface BudgetPolicy {
  on_budget_exceeded: 'fail' | 'warn' | 'continue';
  fail_fast?: boolean;
}

export interface TokenBudgetContract {
  version: string;
  limits: TokenBudgetLimits;
  policy: BudgetPolicy;
  applied_profile?: string;
  profiles?: {
    [key: string]: {
      limits: TokenBudgetLimits;
      policy: BudgetPolicy;
    };
  };
}

interface BudgetStatus {
  exceeded: boolean;
  violations: BudgetViolation[];
  action: 'continue' | 'warn' | 'fail' | 'truncate_and_continue';
}

interface BudgetViolation {
  type: string;
  limit: number | string;
  actual: number | string;
  message: string;
}

export class TokenBudgetEnforcer {
  private contract: TokenBudgetContract;
  private tokenMeter: TokenMeter;
  private logger = getLogger();
  private modelCallCount: number = 0;
  private toolCallCount: number = 0;
  private toolOutputBytes: number = 0;

  constructor(contract: TokenBudgetContract, tokenMeter: TokenMeter) {
    this.contract = contract;
    this.tokenMeter = tokenMeter;
  }

  /**
   * Проверяет, можно ли выполнить вызов модели
   */
  checkModelCall(): BudgetStatus {
    const status: BudgetStatus = {
      exceeded: false,
      violations: [],
      action: 'continue',
    };

    // Проверяем лимит на количество вызовов модели
    if (this.contract.limits.max_model_calls !== undefined) {
      if (this.modelCallCount >= this.contract.limits.max_model_calls) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_model_calls',
          limit: this.contract.limits.max_model_calls,
          actual: this.modelCallCount + 1,
          message: `Model call limit exceeded: ${this.modelCallCount + 1} >= ${this.contract.limits.max_model_calls}`,
        });
      }
    }

    return this.processStatus(status);
  }

  /**
   * Проверяет, можно ли выполнить вызов инструмента
   */
  checkToolCall(): BudgetStatus {
    const status: BudgetStatus = {
      exceeded: false,
      violations: [],
      action: 'continue',
    };

    // Проверяем лимит на количество вызовов инструментов
    if (this.contract.limits.max_tool_calls !== undefined) {
      if (this.toolCallCount >= this.contract.limits.max_tool_calls) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_tool_calls',
          limit: this.contract.limits.max_tool_calls,
          actual: this.toolCallCount + 1,
          message: `Tool call limit exceeded: ${this.toolCallCount + 1} >= ${this.contract.limits.max_tool_calls}`,
        });
      }
    }

    return this.processStatus(status);
  }

  /**
   * Проверяет, можно ли добавить вывод инструмента
   */
  checkToolOutput(output: string): BudgetStatus {
    const outputBytes = new TextEncoder().encode(output).length;
    const totalBytes = this.toolOutputBytes + outputBytes;

    const status: BudgetStatus = {
      exceeded: false,
      violations: [],
      action: 'continue',
    };

    // Проверяем лимит на общий объем вывода инструментов
    if (this.contract.limits.max_tool_output_bytes_total !== undefined) {
      if (totalBytes > this.contract.limits.max_tool_output_bytes_total) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_tool_output_bytes_total',
          limit: this.contract.limits.max_tool_output_bytes_total,
          actual: totalBytes,
          message: `Tool output bytes limit exceeded: ${totalBytes} > ${this.contract.limits.max_tool_output_bytes_total}`,
        });
      }
    }

    return this.processStatus(status);
  }

  /**
   * Проверяет использование токенов после вызова модели
   */
  checkTokenUsage(
    usage: Partial<{
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cost_usd: number;
    }>
  ): BudgetStatus {
    const summary = this.tokenMeter.getSummary();

    const status: BudgetStatus = {
      exceeded: false,
      violations: [],
      action: 'continue',
    };

    // Проверяем лимит на входные токены
    if (this.contract.limits.max_input_tokens !== undefined) {
      const totalInput = summary.total_input_tokens + (usage.input_tokens || 0);
      if (totalInput > this.contract.limits.max_input_tokens) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_input_tokens',
          limit: this.contract.limits.max_input_tokens,
          actual: totalInput,
          message: `Input tokens limit exceeded: ${totalInput} > ${this.contract.limits.max_input_tokens}`,
        });
      }
    }

    // Проверяем лимит на выходные токены
    if (this.contract.limits.max_output_tokens !== undefined) {
      const totalOutput = summary.total_output_tokens + (usage.output_tokens || 0);
      if (totalOutput > this.contract.limits.max_output_tokens) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_output_tokens',
          limit: this.contract.limits.max_output_tokens,
          actual: totalOutput,
          message: `Output tokens limit exceeded: ${totalOutput} > ${this.contract.limits.max_output_tokens}`,
        });
      }
    }

    // Проверяем лимит на общие токены
    if (this.contract.limits.max_total_tokens !== undefined) {
      const totalTokens = summary.total_tokens + (usage.total_tokens || 0);
      if (totalTokens > this.contract.limits.max_total_tokens) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_total_tokens',
          limit: this.contract.limits.max_total_tokens,
          actual: totalTokens,
          message: `Total tokens limit exceeded: ${totalTokens} > ${this.contract.limits.max_total_tokens}`,
        });
      }
    }

    // Проверяем лимит на стоимость
    if (this.contract.limits.max_total_cost_usd !== undefined && usage.cost_usd !== undefined) {
      const totalCost = summary.total_cost_usd + usage.cost_usd;
      if (totalCost > this.contract.limits.max_total_cost_usd) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_total_cost_usd',
          limit: this.contract.limits.max_total_cost_usd,
          actual: totalCost,
          message: `Cost limit exceeded: $${totalCost.toFixed(4)} > $${this.contract.limits.max_total_cost_usd.toFixed(4)}`,
        });
      }
    }

    // Проверяем лимит на выходные токены за один вызов
    if (
      this.contract.limits.max_output_tokens_per_call !== undefined &&
      usage.output_tokens !== undefined
    ) {
      if (usage.output_tokens > this.contract.limits.max_output_tokens_per_call) {
        status.exceeded = true;
        status.violations.push({
          type: 'max_output_tokens_per_call',
          limit: this.contract.limits.max_output_tokens_per_call,
          actual: usage.output_tokens,
          message: `Output tokens per call limit exceeded: ${usage.output_tokens} > ${this.contract.limits.max_output_tokens_per_call}`,
        });
      }
    }

    return this.processStatus(status);
  }

  /**
   * Обновляет внутренние счетчики после успешного вызова
   */
  recordSuccessfulModelCall(): void {
    this.modelCallCount++;
  }

  recordSuccessfulToolCall(output: string): void {
    this.toolCallCount++;
    this.toolOutputBytes += new TextEncoder().encode(output).length;
  }

  /**
   * Обрабатывает статус нарушения бюджета в соответствии с политикой
   */
  private processStatus(status: BudgetStatus): BudgetStatus {
    if (status.exceeded) {
      // Если включена опция fail_fast, всегда устанавливаем действие как 'fail'
      if (this.contract.policy.fail_fast) {
        status.action = 'fail';
      } else {
        status.action = this.contract.policy.on_budget_exceeded;
      }

      // Логируем нарушения
      for (const violation of status.violations) {
        if (status.action === 'warn') {
          this.logger.info(`BUDGET_WARNING: ${violation.message}`);
        } else {
          this.logger.info(`BUDGET_VIOLATION: ${violation.message}`);
        }
      }
    }

    return status;
  }

  /**
   * Создает эпизод нарушения бюджета
   */
  createBudgetViolationEpisode(
    violation: BudgetViolation,
    context: any
  ): Partial<SecurityEventEpisode> {
    return {
      episode_type: 'security_event/resource_budget_exceeded',
      security_event_type: 'resource_budget_exceeded',
      security_event_category: 'policy_violation' as const,
      severity: 'high' as const,
      result_status: 'failed',
      result_summary: `Budget violation: ${violation.type}`,
      detection_source: 'runtime_guard',
      policy_profile_id: 'mova_budget_default_v1',
      security_model_version: '1.0.0',
      result_details: {
        violation_type: violation.type,
        limit: violation.limit,
        actual: violation.actual,
        message: violation.message,
      },
      meta_episode: {
        run_id: context.run_id,
        request_id: context.request_id,
      },
    };
  }

  /**
   * Возвращает текущий статус бюджета
   */
  getStatus(): {
    model_calls: number;
    tool_calls: number;
    tool_output_bytes: number;
    token_usage: TokenSummary;
  } {
    const summary = this.tokenMeter.getSummary();
    return {
      model_calls: this.modelCallCount,
      tool_calls: this.toolCallCount,
      tool_output_bytes: this.toolOutputBytes,
      token_usage: summary,
    };
  }

  /**
   * Возвращает краткую информацию о бюджете для включения в run_summary
   */
  getBudgetInfo() {
    return {
      contract_version: this.contract.version,
      policy: this.contract.policy.on_budget_exceeded,
      limits: this.contract.limits,
      current_usage: this.getStatus(),
    };
  }
}
