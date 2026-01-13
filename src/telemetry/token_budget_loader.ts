/**
 * Загрузчик контракта бюджета токенов для MOVA Agent
 * Загружает конфигурацию из файла, переменной окружения или использует значение по умолчанию
 */

import fs from 'fs';
import path from 'path';
import { TokenBudgetContract } from './token_budget_enforcer';

export class TokenBudgetLoader {
  private defaultConfigPath = './configs/token_budget.default.json';

  /**
   * Загружает контракт бюджета с учетом приоритетов:
   * 1. Путь из параметра (если указан)
   * 2. Путь из переменной окружения MOVA_TOKEN_BUDGET_PATH
   * 3. Файл по умолчанию configs/token_budget.default.json
   * 4. Профиль (если указан)
   */
  async load(budgetPath?: string, profileName?: string): Promise<TokenBudgetContract> {
    let configPath = budgetPath;

    // Если путь не указан, проверяем переменную окружения
    if (!configPath) {
      configPath = process.env.MOVA_TOKEN_BUDGET_PATH;
    }

    // Если переменная окружения не установлена, используем путь по умолчанию
    if (!configPath) {
      configPath = this.defaultConfigPath;
    }

    // Проверяем, существует ли файл
    if (!fs.existsSync(configPath)) {
      throw new Error(`Token budget configuration file not found: ${configPath}`);
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent) as TokenBudgetContract;

      // Валидируем структуру конфигурации
      this.validateConfig(config, configPath);

      // Если указан профиль, применяем его
      if (profileName && config.profiles && config.profiles[profileName]) {
        return this.applyProfile(config, profileName);
      }

      return config;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load token budget configuration from ${configPath}: ${errorMessage}`
      );
    }
  }

  /**
   * Применяет профиль к базовой конфигурации
   */
  private applyProfile(baseConfig: TokenBudgetContract, profileName: string): TokenBudgetContract {
    const profile = baseConfig.profiles?.[profileName];
    if (!profile) {
      throw new Error(`Profile '${profileName}' not found in token budget configuration`);
    }

    // Возвращаем конфигурацию с параметрами профиля, но сохраняя остальные поля
    return {
      ...baseConfig,
      limits: {
        ...baseConfig.limits,
        ...profile.limits,
      },
      policy: {
        ...baseConfig.policy,
        ...profile.policy,
      },
      // Добавляем информацию о примененном профиле
      applied_profile: profileName,
    };
  }

  /**
   * Валидирует структуру конфигурации
   */
  private validateConfig(config: any, configPath: string): void {
    if (!config.version) {
      throw new Error(
        `Invalid token budget configuration at ${configPath}: missing 'version' field`
      );
    }

    // Проверяем, что хотя бы limits или profiles присутствуют
    if (!config.limits && !config.profiles) {
      throw new Error(
        `Invalid token budget configuration at ${configPath}: missing both 'limits' and 'profiles' fields`
      );
    }

    // Если есть policy, проверяем его
    if (config.policy) {
      if (!config.policy.on_budget_exceeded) {
        throw new Error(
          `Invalid token budget configuration at ${configPath}: missing 'policy.on_budget_exceeded' field`
        );
      }

      const validPolicies = ['fail', 'warn', 'continue'];
      if (!validPolicies.includes(config.policy.on_budget_exceeded)) {
        throw new Error(
          `Invalid token budget configuration at ${configPath}: invalid policy value '${config.policy.on_budget_exceeded}'`
        );
      }
    }
  }

  /**
   * Сохраняет резолвнутый контракт в файл
   */
  saveResolvedContract(contract: TokenBudgetContract, evidenceDir: string): string {
    const outputPath = path.join(evidenceDir, 'token_budget.resolved.json');

    // Создаем директорию, если не существует
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(contract, null, 2));
    return outputPath;
  }
}
