import "./config/load-env.js";

import { createApp } from "./app/app.js";
import { env } from "./config/env.js";

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[agencyops-api] listening on port ${env.port} (${env.nodeEnv})`,
  );
});
