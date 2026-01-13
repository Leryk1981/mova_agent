export type DriverContext = {
  driverName?: string;
  allowlist?: string[];
  limits?: {
    timeout_ms?: number;
    max_data_size?: number;
  };
  bindings?: any;
};

export type Driver = {
  execute(input: any, context?: DriverContext): Promise<any>;
};

type DriverFactory = () => Driver;

const driverFactories = new Map<string, DriverFactory>();

export function registerDriver(name: string, factory: DriverFactory): void {
  driverFactories.set(name, factory);
}

export function getDriver(name: string): Driver {
  const factory = driverFactories.get(name);
  if (!factory) {
    throw new Error(`Driver not found: ${name}`);
  }
  return factory();
}

export function listDrivers(): string[] {
  return Array.from(driverFactories.keys());
}

// Built-in noop driver
registerDriver('noop', () => ({
  async execute(input: any): Promise<any> {
    return input;
  },
}));

import { httpDriverFactory } from './httpDriver';
import { restrictedShellDriverFactory } from './restrictedShellDriver';

registerDriver('http', httpDriverFactory);
registerDriver('restricted_shell', restrictedShellDriverFactory);

export { httpDriverFactory, restrictedShellDriverFactory };
