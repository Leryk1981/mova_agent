/**
 * Recursively redacts sensitive information from an object
 * Masks values for keys containing sensitive terms
 */
export function redactSensitiveData(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // If it's an array, process each element
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item));
  }

  // If it's an object, process each key-value pair
  const redactedObj: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // Check if the key contains sensitive terms (case insensitive)
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('authorization') ||
      lowerKey.includes('auth') ||
      lowerKey.includes('key') ||
      lowerKey.includes('api_key') ||
      lowerKey.includes('bearer')
    ) {
      // Redact the value
      redactedObj[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      // Recursively process nested objects
      redactedObj[key] = redactSensitiveData(value);
    } else {
      // Keep the original value
      redactedObj[key] = value;
    }
  }

  return redactedObj;
}