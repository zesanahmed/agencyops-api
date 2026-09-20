/**
 * Loads variables from a .env file into process.env, if one exists.
 *
 * This MUST be the first import in src/server.ts, and must have no
 * imports of its own. ES module imports are evaluated in the order
 * encountered, and a module's own dependency subtree is fully
 * evaluated before its body runs — since this module has zero
 * dependencies, it's guaranteed to execute before anything else
 * (config/env.ts included) gets a chance to read process.env.
 * Just placing a plain statement "before" the other imports in
 * server.ts would NOT be enough on its own — static imports are
 * hoisted ahead of a module's own top-level code regardless of
 * where they appear textually.
 *
 * Uses Node's built-in env file loader (process.loadEnvFile,
 * stable since Node 24.10 / 22.21) — no extra dependency needed.
 * Silently does nothing if no .env file is present, which is
 * expected in production, where the platform injects real
 * environment variables directly rather than via a file.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file found — fine, proceed with whatever is already
  // in process.env (shell-exported vars, platform-injected vars).
}
