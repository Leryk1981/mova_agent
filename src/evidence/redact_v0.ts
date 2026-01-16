import { createHash } from 'crypto';

const SENSITIVE_KEYS = ['token', 'secret', 'key', 'auth', 'password', 'authorization'];

function isSensitiveKey(key: string): boolean {
  const lower = (key || '').toLowerCase();
  return SENSITIVE_KEYS.some((m) => lower.includes(m));
}

function looksSensitiveString(value: string): boolean {
  const lower = (value || '').toLowerCase();
  return SENSITIVE_KEYS.some((m) => lower.includes(m));
}

function mask(value: any): string {
  const hash = createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
  return '***REDACTED:' + hash + '***';
}

function redactValue(value: any, keyHint?: string): any {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v));
  }

  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        out[k] = mask(v);
      } else {
        out[k] = redactValue(v, k);
      }
    }
    return out;
  }

  if (typeof value === 'string') {
    if (isSensitiveKey(keyHint || '') || looksSensitiveString(value)) {
      return mask(value);
    }
    return value;
  }

  return value;
}

export function redactForEvidence(data: any): any {
  return redactValue(data);
}
