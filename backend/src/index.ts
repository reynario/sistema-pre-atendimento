import { buildServer } from "./server.js";
import { startWorkers } from "./workers/index.js";
import { env } from "./env.js";

async function main() {
  const app = await buildServer();
  startWorkers();

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`API pronta em http://localhost:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
