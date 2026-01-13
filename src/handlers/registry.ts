import { getDriver } from '../drivers';

// Тип для контекста выполнения
export interface ExecutionContext {
  run_id: string;
  request_id: string;
  evidence_dir: string;
  caps?: any;
  redaction_rules?: string[];
  step_outputs: Map<string, any>;
}

// Тип для обработчика
export type HandlerFunction = (input: any, tool: any, context: ExecutionContext) => Promise<any>;

class HandlerRegistryClass {
  private handlers: { [key: string]: HandlerFunction } = {};

  constructor() {
    this.handlers = {
      noop: this.buildHandler('noop'),
      http: this.buildHandler('http'),
      restricted_shell: this.buildHandler('restricted_shell'),
    };
  }

  private buildHandler(driverName: string): HandlerFunction {
    return async (input, tool, _context) => {
      const driver = getDriver(driverName);
      return driver.execute(input, {
        driverName,
        allowlist: tool?.binding?.destination_allowlist,
        limits: tool?.binding?.limits,
        bindings: tool?.binding,
      });
    };
  }

  getInstance(): { [key: string]: HandlerFunction } {
    return new Proxy(this.handlers, {
      get: (target, prop: string) => {
        if (!target[prop]) {
          target[prop] = this.buildHandler(prop);
        }
        return target[prop];
      },
    });
  }
}

const registryInstance = new HandlerRegistryClass();

export { registryInstance as HandlerRegistry };
