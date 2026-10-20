import { AppError } from "../errors/AppError.js";

/**
 * Request validation can only compare the dates present in the body. A PATCH that
 * sends just one of them must still be checked against the stored other one, so
 * services call this with the merged (body ?? stored) values.
 */
export function assertDateOrder(
  start: Date | null | undefined,
  end: Date | null | undefined,
  endField: string,
  startField = "startDate",
): void {
  if (start && end && end.getTime() < start.getTime()) {
    throw new AppError(`${endField} must be on or after ${startField}`, 400, [
      { path: endField, message: `${endField} must be on or after ${startField}` },
    ]);
  }
}
