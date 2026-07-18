#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { bootstrap } from "./bootstrap";
import { App } from "./ui/app";

const { config, runtime, scheduler, index } = await bootstrap();
scheduler.start();
const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 });
createRoot(renderer).render(
  <App
    runtime={runtime}
  />,
);
const shutdown = () => {
  scheduler.stop();
  index.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
