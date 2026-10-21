import "../config/load-env.js";

import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { DEMO_CLIENT_EMAIL, DEMO_USERS, resetDemo, seedDemo } from "../seed/demo.js";

/**
 * `npm run seed` (local, tsx) / `npm run seed:built` (compiled, for a deployed environment).
 * `--reset` removes ONLY the demo organization and demo users, then seeds again.
 */
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const reset = args.has("--reset");

  if (env.isProduction && process.env["ALLOW_SEED_IN_PRODUCTION"] !== "true") {
    // eslint-disable-next-line no-console
    console.error(
      "Refusing to seed: NODE_ENV=production. The demo data is public and uses a shared password.\n" +
        "If this really is the demo deployment, run again with ALLOW_SEED_IN_PRODUCTION=true.",
    );
    process.exitCode = 1;
    return;
  }

  if (reset) {
    const { warnings } = await resetDemo();
    // eslint-disable-next-line no-console
    for (const w of warnings) console.warn(`warning: ${w}`);
  }
  const summary = await seedDemo();

  /* eslint-disable no-console */
  console.log(summary.created ? "Demo data created." : "Demo data already present; nothing changed (use --reset to rebuild with fresh dates).");
  console.log(`\nOrganization: ${summary.organizationName} (${summary.organizationId})\n`);
  console.log("Role                 | Email                          | Password");
  console.log("---------------------|--------------------------------|---------");
  const rows: [string, string][] = [
    ...Object.values(DEMO_USERS).map((u): [string, string] => [u.role + (u.documented ? "" : " (extra)"), u.email]),
    ["CLIENT PORTAL", DEMO_CLIENT_EMAIL],
  ];
  for (const [role, email] of rows) console.log(`${role.padEnd(20)} | ${email.padEnd(30)} | ${summary.password}`);
  /* eslint-enable no-console */
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
