export interface RateLimitInputV0 {
  key: string;
  now_ms: number;
  cooldown_ms: number;
  last_sent_ms: number | null;
}

export interface RateLimitDecisionV0 {
  allowed: boolean;
  remaining_ms: number;
}

export function evaluateRateLimit(input: RateLimitInputV0): RateLimitDecisionV0 {
  const { now_ms, cooldown_ms, last_sent_ms } = input;
  if (last_sent_ms === null || typeof last_sent_ms !== 'number') {
    return { allowed: true, remaining_ms: 0 };
  }
  const elapsed = now_ms - last_sent_ms;
  const remaining = cooldown_ms - elapsed;
  if (remaining <= 0) {
    return { allowed: true, remaining_ms: 0 };
  }
  return { allowed: false, remaining_ms: remaining };
}
