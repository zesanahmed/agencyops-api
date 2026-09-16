/**
 * Any value that can be safely serialized as JSON — objects,
 * arrays, primitives, or null. Used instead of `any` so
 * `data` stays type-checked while still accepting whatever
 * shape a given endpoint legitimately returns.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Standard success response envelope.
 * Every successful API response must follow this shape.
 */
export interface SuccessResponse<T extends JsonValue = JsonValue> {
  success: true;
  message: string;
  data: T;
}

/**
 * Standard error response envelope.
 * Every failed API response must follow this shape.
 */
export interface ErrorResponse {
  success: false;
  message: string;
  errors: unknown[];
}
