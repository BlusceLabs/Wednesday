#!/usr/bin/env bun
import { bootstrap } from "./bootstrap";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('Usage: bun run src/headless.ts "your prompt or /command"');
  process.exit(1);
}

const { runtime, index } = await bootstrap();
runtime.events.subscribe((event) => {
  if (event.type === "assistant.delta") process.stdout.write(event.delta);
  if (event.type === "notice") process.stdout.write(event.message + "\n");
  if (event.type === "error") console.error(`\n${event.message}`);
  if (event.type === "assistant.done") process.stdout.write("\n");
});
try {
  await runtime.submit(prompt);
} finally {
  // Release the SQLite WAL handle before exiting.
  index.close();
}
