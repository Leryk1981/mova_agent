// policy/policy_engine.ts
import { getLogger } from '../logging/logger';

interface PolicyRule {
  id: string;
  condition: (context: any) => boolean;
  action: 'allow' | 'deny' | 'log';
  priority: number;
  description?: string;
}

interface PolicyContext {
  subject_ref: string;
  object_ref: string;
  verb: string;
  timestamp: Date;
  input?: any;
  metadata?: any;
}

interface ToolPool {
  tools: Array<{
    id: string;
    connector: any;
    binding: {
      driver_kind: string;
      destination_allowlist?: string[];
      limits?: {
        timeout_ms?: number;
        max_data_size?: number;
      };
      schema_refs?: {
        [key: string]: any;
      };
    };
  }>;
}

interface InstructionProfile {
  caps?: {
    max_timeout_ms?: number;
    max_data_size?: number;
    max_steps?: number;
  };
  redaction_rules?: string[];
}

class PolicyEngine {
  private logger = getLogger();
  private rules: PolicyRule[] = [];
  private toolPool: ToolPool | null = null;
  private instructionProfile: InstructionProfile | null = null;

  constructor() {
    // Устанавливаем базовые правила для deny-by-default политики
    this.setupDefaultPolicy();
  }

  /**
   * Установка политики deny-by-default
   */
  private setupDefaultPolicy() {
    // Добавляем правило, которое по умолчанию запрещает все операции
    // Это правило имеет самый низкий приоритет
    this.rules.push({
      id: 'default-deny',
      condition: () => true, // условие всегда истинно
      action: 'deny',
      priority: 0,
      description: 'Default deny-all policy',
    });
  }

  /**
   * Установка пула инструментов для проверки соответствия
   */
  setToolPool(toolPool: ToolPool): void {
    this.toolPool = toolPool;
  }

  /**
   * Установка профиля инструкций для проверки соответствия
   */
  setInstructionProfile(instructionProfile: InstructionProfile): void {
    this.instructionProfile = instructionProfile;
  }

  /**
   * Добавление нового правила политики
   */
  addRule(rule: PolicyRule): void {
    // Удаляем правило с тем же ID если оно существует
    this.rules = this.rules.filter((r) => r.id !== rule.id);
    this.rules.push(rule);

    // Сортируем по приоритету (высший приоритет первым)
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Проверка политики для заданного контекста
   */
  evaluate(context: PolicyContext): { allowed: boolean; reason?: string } {
    for (const rule of this.rules) {
      if (rule.condition(context)) {
        if (rule.action === 'allow') {
          return { allowed: true };
        } else if (rule.action === 'deny') {
          return {
            allowed: false,
            reason: rule.description || `Denied by policy rule: ${rule.id}`,
          };
        } else if (rule.action === 'log') {
          this.logger.info(
            `Policy log: ${rule.description || `Action logged by rule: ${rule.id}`}: ${JSON.stringify(context)}`
          );
        }
      }
    }

    // По умолчанию запрещаем, если ни одно правило не применилось
    return { allowed: false, reason: 'No policy rule matched, default deny applied' };
  }

  /**
   * Проверка соответствия шага плана политике пула инструментов
   */
  evaluateAgainstToolPool(step: any): { allowed: boolean; reason?: string } {
    if (!this.toolPool) {
      return { allowed: false, reason: 'Tool pool not set for policy evaluation' };
    }

    // Проверяем, что инструмент есть в пуле
    const tool = this.toolPool.tools.find((t) => t.id === step.connector_id);
    if (!tool) {
      return {
        allowed: false,
        reason: `Tool not found in pool: ${step.connector_id}`,
      };
    }

    // Проверяем, что тип драйвера разрешен
    if (tool.binding.driver_kind !== step.verb) {
      return {
        allowed: false,
        reason: `Driver kind mismatch: expected ${tool.binding.driver_kind}, got ${step.verb}`,
      };
    }

    // Проверяем ограничения
    if (step.input && (step.input.url || step.input.endpoint)) {
      const destUrl = step.input.url || step.input.endpoint;
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
          return {
            allowed: false,
            reason: `Destination not allowlisted: ${destUrl}`,
          };
        }
      } else {
        // If no allowlist is defined for HTTP connections, deny by default
        if (tool.binding.driver_kind === 'http') {
          return {
            allowed: false,
            reason: `No destination allowlist defined for HTTP connection to: ${destUrl}`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Проверка соответствия шага плана профилю инструкций
   */
  evaluateAgainstInstructionProfile(_step: any): { allowed: boolean; reason?: string } {
    if (!this.instructionProfile) {
      return { allowed: true }; // If no profile, allow by default (though this shouldn't happen)
    }

    // Check caps if defined in profile
    if (this.instructionProfile.caps) {
      // Check max steps if we're tracking step count
      if (this.instructionProfile.caps.max_steps) {
        // This would be checked at the plan level, not step level
      }
    }

    return { allowed: true };
  }

  /**
   * Проверка безопасности для шага плана
   */
  evaluateStep(
    context: PolicyContext,
    stepInput: any,
    toolBinding: any
  ): { allowed: boolean; reason?: string } {
    // Проверяем все аспекты безопасности
    const inputCheck = this.checkInputSafety(context, stepInput);
    if (!inputCheck.allowed) {
      return inputCheck;
    }

    const bindingCheck = this.checkBindingCompliance(context, toolBinding);
    if (!bindingCheck.allowed) {
      return bindingCheck;
    }

    // Затем применяем общую политику
    return this.evaluate(context);
  }

  /**
   * Комплексная проверка шага против всех политик
   */
  evaluateStepComprehensive(step: any): { allowed: boolean; reason?: string } {
    // Check against tool pool
    const toolPoolCheck = this.evaluateAgainstToolPool(step);
    if (!toolPoolCheck.allowed) {
      return toolPoolCheck;
    }

    // Check against instruction profile
    const profileCheck = this.evaluateAgainstInstructionProfile(step);
    if (!profileCheck.allowed) {
      return profileCheck;
    }

    // If we have a context, run standard evaluation too
    if (step.context) {
      return this.evaluate(step.context);
    }

    return { allowed: true };
  }

  /**
   * Проверка безопасности ввода
   */
  private checkInputSafety(
    context: PolicyContext,
    input: any
  ): { allowed: boolean; reason?: string } {
    if (!input) {
      return { allowed: true }; // Пустой ввод безопасен
    }

    // Проверяем потенциально опасные элементы во вводе
    if (this.containsDangerousPaths(input)) {
      return {
        allowed: false,
        reason: 'Input contains potentially dangerous path sequences (.., /etc/, etc.)',
      };
    }

    // Проверяем на потенциально опасные команды
    if (this.containsDangerousCommands(input)) {
      return {
        allowed: false,
        reason: 'Input contains potentially dangerous commands',
      };
    }

    return { allowed: true };
  }

  /**
   * Проверка соответствия binding требованиям
   */
  private checkBindingCompliance(
    context: PolicyContext,
    binding: any
  ): { allowed: boolean; reason?: string } {
    if (!binding) {
      return { allowed: false, reason: 'Binding is required and was not provided' };
    }

    // Проверяем, что все требуемые поля присутствуют
    if (!binding.driver_kind) {
      return { allowed: false, reason: 'driver_kind is required in binding' };
    }

    // Проверяем, что указаны ограничения
    if (!binding.limits || !binding.limits.timeout_ms) {
      return { allowed: false, reason: 'Limits with timeout_ms are required in binding' };
    }

    // Проверяем ограничения на размер данных
    if (!binding.limits.max_data_size) {
      this.logger.info('WARNING: max_data_size not specified in binding, using default');
    }

    // Если это HTTP-биндинг, проверяем список разрешенных адресов
    if (binding.driver_kind === 'http' && binding.destination_allowlist) {
      // Политика deny-by-default: если нет списка разрешенных, запрещаем
      if (
        !Array.isArray(binding.destination_allowlist) ||
        binding.destination_allowlist.length === 0
      ) {
        return {
          allowed: false,
          reason:
            'destination_allowlist is required for HTTP bindings and was not properly specified',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Проверка на наличие потенциально опасных путей
   */
  private containsDangerousPaths(obj: any): boolean {
    if (typeof obj === 'string') {
      // Проверяем на пути к системным директориям
      return (
        obj.includes('..') ||
        obj.includes('/etc/') ||
        obj.includes('/root/') ||
        obj.includes('/proc/') ||
        obj.includes('/sys/')
      );
    }

    if (typeof obj === 'object' && obj !== null) {
      for (const value of Object.values(obj)) {
        if (this.containsDangerousPaths(value)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Проверка на наличие потенциально опасных команд
   */
  private containsDangerousCommands(obj: any): boolean {
    if (typeof obj === 'string') {
      const dangerousCommands = [
        'rm -rf',
        'rm ',
        'chmod',
        'chown',
        'mv /',
        'cp /etc/',
        'cat /etc/',
        'echo > /etc/',
        'sudo ',
        'su ',
        'eval ',
        'exec(',
        'exec ',
        'shell_exec',
        'system(',
        'passthru',
      ];

      return dangerousCommands.some((cmd) => obj.toLowerCase().includes(cmd.toLowerCase()));
    }

    if (typeof obj === 'object' && obj !== null) {
      for (const value of Object.values(obj)) {
        if (this.containsDangerousCommands(value)) {
          return true;
        }
      }
    }

    return false;
  }
}

export { PolicyEngine, PolicyRule, PolicyContext, ToolPool, InstructionProfile };
