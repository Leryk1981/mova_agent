import {
  Driver,
  DriverContext,
  DriverFactory,
  httpDriverFactory,
  restrictedShellDriverFactory,
} from '@leryk1981/mova-executors';
import { noopDeliveryDriverV0Factory } from './noop_delivery_driver_v0';
import { noopWebhookDriverV0Factory } from './noop_webhook_driver_v0';
import { httpWebhookDeliveryDriverV1Factory } from './http_webhook_delivery_driver_v1';

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
registerDriver('noop_delivery_v0', noopDeliveryDriverV0Factory);
registerDriver('noop_webhook_v0', noopWebhookDriverV0Factory);
registerDriver('http_webhook_delivery_v1', httpWebhookDeliveryDriverV1Factory);

export {
  Driver,
  DriverContext,
  DriverFactory,
  httpDriverFactory,
  restrictedShellDriverFactory,
  noopDeliveryDriverV0Factory,
  noopWebhookDriverV0Factory,
  httpWebhookDeliveryDriverV1Factory,
};
