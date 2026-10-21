import { z } from "zod";

/**
 * `z.coerce.date()` runs `new Date(value)`, and `new Date(null)` is 1970-01-01, so a bare
 * `z.coerce.date().optional()` silently accepts `null` as the epoch. These helpers make the
 * handling of `null` explicit. Invalid dates ("abc", "") are always a 400.
 */

/** Optional date that may be explicitly `null` to clear the stored value. */
export const clearableDate = z.union([z.null(), z.coerce.date()]).optional();

/** Date that must be a real date when present; `null` is rejected rather than turned into 1970. */
export const requiredDate = z
  .unknown()
  .refine((v) => v !== null, { message: "Date cannot be null" })
  .pipe(z.coerce.date());
