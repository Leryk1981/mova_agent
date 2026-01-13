/**
 * Модуль измерения и учета токенов для MOVA Agent
 * Собирает статистику по использованию токенов и стоимости
 */

import fs from 'fs';
import path from 'path';
import { getLogger } from '../logging/logger';

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  cost_usd?: number;
  provider?: string;
  model?: string;
  timestamp: string;
}

export interface TokenSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  call_count: number;
  usage_available: boolean;
  calls: TokenUsage[];
}

export class TokenMeter {
  private summary: TokenSummary;
  private evidenceDir: string;

  constructor(evidenceDir?: string) {
    this.summary = {
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      call_count: 0,
      usage_available: true,
      calls: [],
    };
    this.evidenceDir = evidenceDir || './artifacts';
  }

  /**
   * Регистрирует использование токенов для одного вызова модели
   */
  recordUsage(usage: Partial<TokenUsage>): void {
    const logger = getLogger();
    const now = new Date().toISOString();

    // Проверяем, есть ли данные о токенах
    const hasTokenData =
      usage.input_tokens !== undefined ||
      usage.output_tokens !== undefined ||
      usage.total_tokens !== undefined;

    if (!hasTokenData) {
      this.summary.usage_available = false;
      // Если данные о токенах отсутствуют, используем эвристическую оценку
      if (usage.model && usage.provider) {
        // Простая эвристика: если модель и провайдер известны, но токены не указаны,
        // можно использовать приблизительную оценку
        logger.info(
          `Token usage not available from provider, using estimation for model: ${usage.model}`
        );
      }
      return;
    }

    // Создаем запись о использовании
    const usageRecord: TokenUsage = {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0),
      cached_tokens: usage.cached_tokens,
      cost_usd: usage.cost_usd || 0,
      provider: usage.provider,
      model: usage.model,
      timestamp: now,
    };

    // Обновляем сводку
    this.summary.total_input_tokens += usageRecord.input_tokens;
    this.summary.total_output_tokens += usageRecord.output_tokens;
    this.summary.total_tokens += usageRecord.total_tokens;
    this.summary.total_cost_usd += usageRecord.cost_usd || 0;
    this.summary.call_count += 1;

    this.summary.calls.push(usageRecord);
  }

  /**
   * Возвращает текущую сводку по использованию токенов
   */
  getSummary(): TokenSummary {
    return { ...this.summary };
  }

  /**
   * Сбрасывает счетчики
   */
  reset(): void {
    this.summary = {
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      call_count: 0,
      usage_available: true,
      calls: [],
    };
  }

  /**
   * Сохраняет отчет об использовании токенов в файл
   */
  saveReport(filePath?: string, reason?: string): string {
    const outputPath = filePath || path.join(this.evidenceDir, 'token_usage.json');

    // Создаем директорию, если не существует
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let report;
    if (this.summary.call_count === 0) {
      // No LLM calls were made, so usage is not applicable
      report = {
        timestamp: new Date().toISOString(),
        measurement_mode: 'no_llm_calls',
        reason: reason || 'no provider calls executed',
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        call_count: 0,
        usage_available: false,
        calls: [],
      };
    } else {
      report = {
        timestamp: new Date().toISOString(),
        measurement_mode: this.summary.usage_available ? 'provider_usage' : 'estimated',
        ...this.getSummary(),
      };
    }

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    return outputPath;
  }

  /**
   * Возвращает краткую сводку для включения в run_summary
   */
  getBriefSummary() {
    return {
      total_input_tokens: this.summary.total_input_tokens,
      total_output_tokens: this.summary.total_output_tokens,
      total_tokens: this.summary.total_tokens,
      total_cost_usd: this.summary.total_cost_usd,
      call_count: this.summary.call_count,
      usage_available: this.summary.usage_available,
      measurement_mode: this.summary.usage_available ? 'provider_usage' : 'estimated',
      per_call_summary:
        this.summary.calls.length <= 5
          ? this.summary.calls
          : [
              ...this.summary.calls.slice(0, 2),
              {
                input_tokens: -1,
                output_tokens: -1,
                total_tokens: -1,
                timestamp: '...',
                note: `... and ${this.summary.calls.length - 4} more calls ...`,
              },
              ...this.summary.calls.slice(-2),
            ],
    };
  }
}
