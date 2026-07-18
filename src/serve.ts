#!/usr/bin/env bun
import { bootstrap } from "./bootstrap";
import { createServerHandler } from "./server/app";
import { loadServerConfig, validateServerConfig } from "./server/config";

const { config, secrets, runtime, index, scheduler } = await bootstrap();
const serverConfig = loadServerConfig(
  config,
  await secrets.get("server:token"),
);
validateServerConfig(serverConfig);
scheduler.start();
const server = Bun.serve({
  hostname: serverConfig.host,
  port: serverConfig.port,
  fetch: createServerHandler(runtime, serverConfig),
});
console.log(
  "Wednesday is listening on http://" + serverConfig.host + ":" + server.port,
);
console.log(
  serverConfig.token
    ? "OS-keychain bearer authentication enabled."
    : "Localhost-only mode.",
);
if (config.scheduler.enabled)
  console.log(
    `Proactive scheduler running ${config.scheduler.tasks.length} task(s).`,
  );
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  scheduler.stop();
  runtime.abort();
  server.stop();
  index.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
