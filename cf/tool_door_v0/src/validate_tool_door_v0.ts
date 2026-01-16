import Ajv from "ajv";
import requestSchema from "../../../ds/tool_door_request_v0.schema.json";
import receiptSchema from "../../../ds/tool_door_receipt_v0.schema.json";

const ajv = new Ajv();

// Compile schemas once
const validateToolDoorRequest = ajv.compile(requestSchema);
const validateToolDoorReceipt = ajv.compile(receiptSchema);

/**
 * Validates a tool door request against the v0 schema
 * @param payload The request data to validate
 * @returns Validation result with ok flag and errors if any
 */
export function validateRequest(payload: any): { ok: true } | { ok: false; errors: any[] } {
  const isValid = validateToolDoorRequest(payload);
  if (isValid) {
    return { ok: true };
  } else {
    return { 
      ok: false, 
      errors: validateToolDoorRequest.errors ? [...validateToolDoorRequest.errors] : [] 
    };
  }
}

/**
 * Validates a tool door receipt against the v0 schema
 * @param payload The receipt data to validate
 * @returns Validation result with ok flag and errors if any
 */
export function validateReceipt(payload: any): { ok: true } | { ok: false; errors: any[] } {
  const isValid = validateToolDoorReceipt(payload);
  if (isValid) {
    return { ok: true };
  } else {
    return { 
      ok: false, 
      errors: validateToolDoorReceipt.errors ? [...validateToolDoorReceipt.errors] : [] 
    };
  }
}