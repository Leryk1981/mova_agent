import { Driver, DriverContext } from '@leryk1981/mova-executors';
import { randomUUID } from 'crypto';

export interface NoopDeliveryInput {
  target: string;
  payload?: any;
  dry_run?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NoopDeliveryOutput {
  delivery_id: string;
  status: 'noop';
  delivered: false;
  dry_run: boolean;
  target: string;
  echo: any;
  meta: {
    driver_version: 'noop_delivery_v0';
    timestamp: string;
  };
}

/**
 * Noop delivery driver that only echoes the input for auditing.
 */
export function noopDeliveryDriverV0Factory(): Driver {
  return {
    async execute(input: NoopDeliveryInput, _context?: DriverContext): Promise<NoopDeliveryOutput> {
      return {
        delivery_id: `noop_${randomUUID()}`,
        status: 'noop',
        delivered: false,
        dry_run: input.dry_run !== false,
        target: input.target,
        echo: input.payload || null,
        meta: {
          driver_version: 'noop_delivery_v0',
          timestamp: new Date().toISOString(),
        },
      };
    },
  };
}
