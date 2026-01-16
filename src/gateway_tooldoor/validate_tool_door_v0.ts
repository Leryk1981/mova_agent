import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// Define the schemas directly since importing JSON might cause issues in some contexts
const requestSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "MOVA Tool Door Request v0",
  "description": "Universal MOVA envelope for tool door requests",
  "required": ["policy_profile_id", "request"],
  "properties": {
    "policy_profile_id": {
      "type": "string",
      "description": "Identifier for the policy profile to use",
      "minLength": 1
    },
    "env_ref": {
      "type": "string",
      "description": "Optional environment reference"
    },
    "request": {
      "type": "object",
      "description": "Free-form request object",
      "additionalProperties": true
    },
    "context": {
      "type": "object",
      "description": "Contextual information for the request",
      "additionalProperties": true
    },
    "idempotency_key": {
      "type": "string",
      "description": "Optional idempotency key to prevent duplicate processing",
      "minLength": 1
    }
  },
  "additionalProperties": false
};

const receiptSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "MOVA Tool Door Receipt v0",
  "description": "Universal receipt for tool door responses",
  "required": ["ok", "outcome_code", "evidence_ref", "policy_trail_ref", "result_core_hash"],
  "properties": {
    "ok": {
      "type": "boolean",
      "description": "Indicates if the operation was successful"
    },
    "outcome_code": {
      "type": "string",
      "description": "Specific outcome code",
      "enum": [
        "DELIVERED",
        "EXTERNAL_CALL_OK",
        "DUPLICATE_SUPPRESSED",
        "THROTTLED",
        "POLICY_DENIED",
        "BAD_REQUEST",
        "UNAUTHORIZED",
        "RETRY_EXHAUSTED",
        "INTERNAL_ERROR"
      ]
    },
    "evidence_ref": {
      "type": "string",
      "description": "Reference to the evidence record",
      "minLength": 1
    },
    "policy_trail_ref": {
      "type": "string",
      "description": "Reference to the policy trail record",
      "minLength": 1
    },
    "result_core_hash": {
      "type": "string",
      "description": "Hash of the result core",
      "minLength": 1
    }
  },
  "additionalProperties": false
};

const ajv = new Ajv();
addFormats(ajv);

// Compile schemas
export const validateToolDoorRequestV0 = ajv.compile(requestSchema);
export const validateToolDoorReceiptV0 = ajv.compile(receiptSchema);

/**
 * Validates a tool door request against the v0 schema
 * @param data The request data to validate
 * @returns Validation result with isValid flag and errors if any
 */
export function validateRequest(data: any): { isValid: boolean; errors?: any[] } {
  const isValid = validateToolDoorRequestV0(data);
  if (!isValid) {
    return { isValid: false, errors: validateToolDoorRequestV0.errors ? [...validateToolDoorRequestV0.errors] : undefined };
  }
  return { isValid: true };
}

/**
 * Validates a tool door receipt against the v0 schema
 * @param data The receipt data to validate
 * @returns Validation result with isValid flag and errors if any
 */
export function validateReceipt(data: any): { isValid: boolean; errors?: any[] } {
  const isValid = validateToolDoorReceiptV0(data);
  if (!isValid) {
    return { isValid: false, errors: validateToolDoorReceiptV0.errors ? [...validateToolDoorReceiptV0.errors] : undefined };
  }
  return { isValid: true };
}