import { loadConfig } from "./config/env.js";
import { createApplication } from "./composition-root.js";

const config = loadConfig();
const app = await createApplication(config);
await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

