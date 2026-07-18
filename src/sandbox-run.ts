#!/usr/bin/env bun
import { loadConfig } from "./core/config";
import { DockerSandbox } from "./sandbox/docker";

const command = process.argv.slice(2).join(" ").trim();
if (!command) {
  console.error('Usage: bun run sandbox -- "command"');
  process.exit(1);
}

const config = loadConfig();
const sandbox = new DockerSandbox(config.sandbox);
const check = await sandbox.doctor();
if (!check.ok) throw new Error(check.detail);
if (!sandbox.enabled)
  throw new Error("Enable it with: bun run config -- set sandbox.enabled true");
const result = await sandbox.run(command);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
