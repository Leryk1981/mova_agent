import { Driver, DriverContext } from '@leryk1981/mova-executors';
import { randomUUID } from 'crypto';

export interface NoopWebhookInput {
  target: string;
  payload?: any;
  dry_run?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NoopWebhookOutput {
  call_id: string;
  status: 'noop';
  delivered: false;
  dry_run: boolean;
  target: string;
  echo: any;
  meta: {
    driver_version: 'noop_webhook_v0';
    timestamp: string;
  };
}

/**
 * Noop webhook driver that only echoes the input for audit.
 */
export function noopWebhookDriverV0Factory(): Driver {
  return {
    async execute(input: NoopWebhookInput, _context?: DriverContext): Promise<NoopWebhookOutput> {
      return {
        call_id: `noop_webhook_${randomUUID()}`,
        status: 'noop',
        delivered: false,
        dry_run: input.dry_run !== false,
        target: input.target,
        echo: input.payload || null,
        meta: {
          driver_version: 'noop_webhook_v0',
          timestamp: new Date().toISOString(),
        },
      };
    },
  };
}
