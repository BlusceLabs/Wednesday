#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defaultSettings } from "./core/config";
const exec = promisify(execFile);
const python = defaultSettings().browser.pythonExecutable;
const target = dirname(dirname(python));
const requirements = fileURLToPath(
  new URL("../python/requirements.txt", import.meta.url),
);
if (!existsSync(python))
  await exec(
    process.platform === "win32" ? "py" : "python3",
    ["-m", "venv", target],
    { timeout: 120_000 },
  );
await exec(python, ["-m", "pip", "install", "--upgrade", "pip"], {
  timeout: 300_000,
});
await exec(python, ["-m", "pip", "install", "-r", requirements], {
  timeout: 600_000,
  maxBuffer: 5_000_000,
});
console.log(`CloakBrowser 0.4.10 and Scrapling 0.4.9 installed at ${python}`);
