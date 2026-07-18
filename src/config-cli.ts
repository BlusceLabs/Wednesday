#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import {
  configPath,
  initializeConfig,
  loadSettings,
  saveSettings,
  validateSettings,
} from "./core/config";
import { providerSecretName, SecretStore } from "./core/secrets";

const [command, ...args] = process.argv.slice(2);
const settings = loadSettings();
const secrets = new SecretStore();
const setPath = (
  object: Record<string, unknown>,
  path: string,
  value: unknown,
) => {
  const keys = path.split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1))
    cursor = (cursor[key] ??= {}) as Record<string, unknown>;
  cursor[keys.at(-1)!] = value;
};
const parse = (value: string) =>
  value === "true"
    ? true
    : value === "false"
      ? false
      : /^-?\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : value;

if (command === "init") console.log(initializeConfig(args.includes("--force")));
else if (command === "path") console.log(configPath());
else if (command === "show") console.log(JSON.stringify(settings, null, 2));
else if (command === "validate") {
  const result = validateSettings(settings);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === "set") {
  if (args.length < 2)
    throw new Error("Usage: wednesday config set <path> <value>");
  setPath(
    settings as unknown as Record<string, unknown>,
    args[0],
    parse(args.slice(1).join(" ")),
  );
  const result = validateSettings(settings);
  if (!result.ok) {
    console.log("Cannot save - settings are invalid:");
    console.log(JSON.stringify(result.issues, null, 2));
    process.exitCode = 1;
  } else {
    console.log(saveSettings(settings));
  }
} else if (command === "schedule" && args[0] === "list") {
  console.log(JSON.stringify(settings.scheduler, null, 2));
} else if (command === "schedule" && args[0] === "add") {
  const [, name, intervalMinutesRaw, ...promptParts] = args;
  const intervalMinutes = Number(intervalMinutesRaw);
  if (!name || !Number.isFinite(intervalMinutes) || promptParts.length === 0)
    throw new Error(
      "Usage: wednesday config schedule add <name> <intervalMinutes> <prompt...>",
    );
  settings.scheduler.tasks.push({
    id: randomUUID(),
    name,
    intervalMinutes,
    prompt: promptParts.join(" "),
  });
  settings.scheduler.enabled = true;
  console.log(saveSettings(settings));
} else if (command === "schedule" && args[0] === "remove") {
  const id = args[1];
  if (!id) throw new Error("Usage: wednesday config schedule remove <id>");
  settings.scheduler.tasks = settings.scheduler.tasks.filter(
    (task) => task.id !== id,
  );
  console.log(saveSettings(settings));
} else if (command === "secret" && args[0] === "set") {
  const name = args[1]?.includes(":")
    ? args[1]
    : providerSecretName(args[1] ?? settings.model.provider);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  await secrets.set(name, Buffer.concat(chunks).toString("utf8").trim());
  console.log(`Stored ${name} in ${await secrets.backend()}`);
} else if (command === "secret" && args[0] === "status") {
  const name = args[1]?.includes(":")
    ? args[1]
    : providerSecretName(args[1] ?? settings.model.provider);
  console.log(
    JSON.stringify({
      name,
      configured: Boolean(await secrets.get(name)),
      backend: await secrets.backend(),
    }),
  );
} else
  console.log(
    "Commands: init [--force] | path | show | validate | set <path> <value> | " +
      "schedule list | schedule add <name> <intervalMinutes> <prompt...> | schedule remove <id> | " +
      "secret set [provider] | secret status [provider]",
  );
