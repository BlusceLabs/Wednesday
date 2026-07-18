#!/usr/bin/env bun
import { existsSync, readFileSync, renameSync } from "node:fs";
import { mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { initializeConfig, loadSettings, saveSettings } from "./core/config";
import { providerSecretName, SecretStore } from "./core/secrets";

initializeConfig();
const settings = loadSettings(),
  secrets = new SecretStore();
const legacyHome = resolve(".ana");
if (existsSync(legacyHome) && !existsSync(settings.home)) {
  await mkdir(settings.home, { recursive: true });
  await cp(legacyHome, settings.home, { recursive: true });
  console.log(`Copied legacy data from ${legacyHome} to ${settings.home}`);
}
const envPath = resolve(".env");
if (existsSync(envPath)) {
  const entries = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  settings.model.provider =
    entries.WEDNESDAY_MODEL_PROVIDER ??
    entries.ANA_MODEL_PROVIDER ??
    settings.model.provider;
  settings.model.id =
    entries.WEDNESDAY_MODEL_ID ?? entries.ANA_MODEL_ID ?? settings.model.id;
  settings.workspace = entries.WEDNESDAY_WORKSPACE ?? settings.workspace;
  const keyNames: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
  };
  const key = entries[keyNames[settings.model.provider]];
  if (key) await secrets.set(providerSecretName(settings.model.provider), key);
  saveSettings(settings);
  renameSync(envPath, envPath + ".retired");
  console.log("Migrated legacy settings and retired .env");
}
console.log("Migration complete");
