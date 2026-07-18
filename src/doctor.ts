#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BrowserUse } from "./browser/use";
import { initializeConfig, loadConfig, validateSettings } from "./core/config";
import { EventJournal } from "./core/journal";
import { providerSecretName, SecretStore } from "./core/secrets";
import { MemoryIndex } from "./memory/index";
import { MarkdownVault } from "./memory/vault";
import { WednesdayModelManager } from "./models/manager";
import { DockerSandbox } from "./sandbox/docker";
import { loadServerConfig, validateServerConfig } from "./server/config";
import { SessionStore } from "./sessions/store";
import { speak } from "./voice/speak";
const exec = promisify(execFile);
const FIX = process.argv.includes("--fix");
initializeConfig();
const config = loadConfig(),
  secrets = new SecretStore(),
  checks: Array<[string, boolean, string]> = [];

async function remediate(label: string, fn: () => Promise<string>) {
  if (!FIX) return;
  try {
    const detail = await fn();
    console.log(`  ↳ fixed: ${label} · ${detail}`);
  } catch (e) {
    console.log(
      `  ↳ could not fix: ${label} · ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function ensureCommand(name: string): Promise<boolean> {
  try {
    await exec(name, ["--version"]);
    return true;
  } catch {
    return false;
  }
}
checks.push(["Configuration", true, config.configPath]);
const validation = validateSettings(config);
checks.push([
  "Configuration validity",
  validation.ok,
  validation.ok ? "no issues" : validation.issues.join("; "),
]);
const backend = await secrets.backend();
checks.push(["Secret store", backend !== "unavailable", backend]);
if (FIX && backend === "unavailable") {
  await remediate("secret store", async () => {
    await secrets.set("probe", "ok").catch(() => undefined);
    const after = await secrets.backend();
    if (after === "unavailable")
      throw new Error("no Secret Service backend available");
    return after;
  });
}
try {
  const server = loadServerConfig(config, await secrets.get("server:token"));
  validateServerConfig(server);
  checks.push([
    "HTTP gateway",
    true,
    `${server.host}:${server.port} · ${server.token ? "keychain token" : "localhost only"} · rate limit ${config.server.rateLimit.max}/${config.server.rateLimit.windowMs}ms`,
  ]);
} catch (e) {
  checks.push(["HTTP gateway", false, String(e)]);
}
try {
  const vault = new MarkdownVault(config.vault);
  await vault.initialize();
  checks.push(["Vault", true, config.vault]);
} catch (e) {
  checks.push(["Vault", false, String(e)]);
}
try {
  const index = await MemoryIndex.create(
    config.index,
    config.memory.embeddingsEnabled,
  );
  index.search("doctor");
  const stale = index.stale(config.memory.staleDays, 1000).length;
  index.close();
  checks.push([
    "SQLite FTS5",
    true,
    `${config.index} · embeddings ${config.memory.embeddingsEnabled ? "on" : "off"} · ${stale} stale memor${stale === 1 ? "y" : "ies"}`,
  ]);
} catch (e) {
  checks.push(["SQLite FTS5", false, String(e)]);
}
try {
  const info = await new SessionStore(config.sessionFile).info();
  checks.push(["Session store", true, `${info.messages} messages`]);
} catch (e) {
  checks.push(["Session store", false, String(e)]);
}
try {
  const journalVerify = await new EventJournal(config.journal).verify();
  checks.push([
    "Audit journal integrity",
    journalVerify.ok,
    journalVerify.ok
      ? `${journalVerify.entries} events chained`
      : `tamper suspected at line ${journalVerify.firstBad}`,
  ]);
} catch (e) {
  checks.push(["Audit journal integrity", false, String(e)]);
}
try {
  const { stdout } = await exec("git", ["--version"]);
  checks.push([
    "Git history",
    true,
    config.gitHistory ? stdout.trim() : "disabled",
  ]);
} catch (e) {
  checks.push(["Git history", !config.gitHistory, String(e)]);
}
checks.push([
  "Git remote sync",
  true,
  config.git.remote ? config.git.remote : "not configured (optional)",
]);
checks.push([
  "Proactive scheduler",
  true,
  config.scheduler.enabled
    ? `enabled · ${config.scheduler.tasks.length} task(s)`
    : "disabled",
]);
if (config.voice.enabled) {
  try {
    await speak("Wednesday doctor check.", { ...config.voice, enabled: true });
    checks.push(["Voice output", true, config.voice.engine]);
  } catch (e) {
    checks.push(["Voice output", false, String(e)]);
  }
} else {
  checks.push(["Voice output", true, "disabled"]);
}
checks.push([
  "Calendar integration",
  true,
  config.integrations.calendar.provider === "none"
    ? "not configured (optional)"
    : config.integrations.calendar.provider,
]);
checks.push([
  "Email integration",
  true,
  config.integrations.email.provider === "none"
    ? "not configured (optional)"
    : config.integrations.email.provider,
]);
const browser = await new BrowserUse(config.browser).doctor();
checks.push(["Browser adapters", browser.ok, browser.detail]);
if (FIX && !browser.ok) {
  await remediate("python browser adapters", async () => {
    const pyReady = await exec(
      config.browser.pythonExecutable,
      ["-c", "import cloakbrowser,scrapling"],
      { timeout: 10_000 },
    )
      .then(() => true)
      .catch(() => false);
    if (pyReady) return "already present";
    await exec(process.execPath, ["src/setup-python.ts"], {
      timeout: 600_000,
    });
    const recheck = await exec(
      config.browser.pythonExecutable,
      ["-c", "import cloakbrowser,scrapling"],
      { timeout: 10_000 },
    )
      .then(() => true)
      .catch(() => false);
    if (!recheck) throw new Error("python adapters still missing after install");
    return "installed";
  });
  await remediate("chromium", async () => {
    if (await ensureCommand(config.browser.chromiumExecutable))
      return "already present";
    const installers: Array<[string, string[]]> = [
      ["brew", ["install", "chromium"]],
      ["apt-get", ["install", "-y", "chromium"]],
      ["dnf", ["install", "-y", "chromium"]],
      ["pacman", ["-S", "--noconfirm", "chromium"]],
    ];
    let lastError: string | undefined;
    let needsPrivilege = false;
    for (const [cmd, args] of installers) {
      if (!(await ensureCommand(cmd))) continue;
      try {
        await exec(cmd, args, { timeout: 900_000 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = `${cmd} failed: ${msg}`;
        if (/superuser|permission|elevated|root/i.test(msg)) needsPrivilege = true;
        continue;
      }
      if (await ensureCommand(config.browser.chromiumExecutable))
        return `installed via ${cmd}`;
      lastError = `${cmd} installed but ${config.browser.chromiumExecutable} still not found`;
    }
    if (needsPrivilege)
      throw new Error(
        "system package install requires root — run `sudo wednesday doctor --fix` (or `sudo dnf install chromium`)",
      );
    throw new Error(
      lastError ?? "no supported package manager (brew/apt/dnf/pacman) found",
    );
  });
}
const sandbox = await new DockerSandbox(config.sandbox).doctor();
checks.push(["Docker sandbox", sandbox.ok, sandbox.detail]);
try {
  const key = await secrets.get(providerSecretName(config.model.provider));
  const models = new WednesdayModelManager(config, key);
  checks.push(["Model", true, models.label]);
  checks.push([
    "Authentication",
    Boolean(await models.authStatus()),
    key ? "OS keychain" : "provider auth unavailable",
  ]);
} catch (e) {
  checks.push(["Model", false, String(e)]);
}
for (const [name, ok, detail] of checks)
  console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
if (FIX) console.log("\nRan remediation pass. Re-run without --fix to verify.");
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
