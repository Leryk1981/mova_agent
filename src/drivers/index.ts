import {
  Driver,
  DriverContext,
  DriverFactory,
  httpDriverFactory,
  restrictedShellDriverFactory
} from '@leryk1981/mova-executors';

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

registerDriver('http', httpDriverFactory);
registerDriver('restricted_shell', restrictedShellDriverFactory);

export {
  Driver,
  DriverContext,
  DriverFactory,
  httpDriverFactory,
  restrictedShellDriverFactory
};
