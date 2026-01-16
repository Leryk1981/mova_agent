/**
 * Computes SHA-256 hash of input string and returns it as hex
 */
export async function sha256Hex(input: string): Promise<string> {
  // Convert string to Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  
  // Compute hash using Web Crypto API
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexString = hashArray
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  
  return hexString;
}