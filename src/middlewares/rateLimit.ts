import rateLimit from "express-rate-limit";
import { AppError } from "../errors/AppError.js";
import { env } from "../config/env.js";

// Skipped entirely in the test environment — the automated suite
// legitimately makes far more than 10 register/login calls in a run,
// and a real brute-force test belongs in its own focused test, not
// as a side effect every other test has to work around.
const skipInTest = () => env.nodeEnv === "test";

/**
 * Register/login: the most sensitive endpoints to brute-force —
 * tight limit. Uses the existing AppError/error envelope rather than
 * express-rate-limit's own default plaintext response, so a 429
 * looks like every other error from this API.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: () => {
    throw new AppError("Too many attempts. Please try again later.", 429);
  },
});

/**
 * Refresh is called routinely by legitimate clients (every access
 * token expiry), so this is deliberately looser than the
 * register/login limiter — it's here to catch abuse, not normal use.
 */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: () => {
    throw new AppError("Too many attempts. Please try again later.", 429);
  },
});
