import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { BrowserConfig } from "../core/config";

const exec = promisify(execFile);
const bridge = fileURLToPath(
  new URL("../../python/bridge.py", import.meta.url),
);

function privateAddress(address: string) {
  if (
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:")
  )
    return true;
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  return false;
}

/** True if `robotsText` disallows crawling `pathname` (case-insensitive Disallow). */
export function robotsDisallows(robotsText: string, pathname: string): boolean {
  const disallowed = robotsText
    .split(/\r?\n/)
    .filter((line) => /^disallow:/i.test(line))
    .map((line) => line.split(":").slice(1).join(":").trim())
    .filter(Boolean);
  return disallowed.some((prefix) => pathname.startsWith(prefix));
}

export class BrowserUse {
  readonly enabled: boolean;
  constructor(private readonly config: BrowserConfig) {
    this.enabled = config.enabled;
  }

  get chromiumExecutable() {
    return this.config.chromiumExecutable;
  }

  /**
   * SSRF + policy guard for every browser entry point. `open()` routes
   * through it, and `browser_screenshot` (in the extended tools) calls it
   * directly so screenshots honor the same private-host and robots.txt
   * policy instead of bypassing it.
   */
  async validate(url: string) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol))
      throw new Error("Only HTTP(S) URLs are allowed");
    if (!this.config.allowPrivateHosts) {
      const addresses = await lookup(parsed.hostname, { all: true });
      if (addresses.some(({ address }) => privateAddress(address)))
        throw new Error(
          "Private and loopback hosts are blocked by browser policy",
        );
    }
    if (this.config.respectRobots) {
      try {
        const robots = await fetch(new URL("/robots.txt", parsed.origin), {
          signal: AbortSignal.timeout(5000),
        }).then((r) => (r.ok ? r.text() : ""));
        if (robotsDisallows(robots, parsed.pathname))
          throw new Error("Blocked by robots.txt policy");
      } catch (error) {
        if (error instanceof Error && error.message.includes("robots.txt"))
          throw error;
      }
    }
    return parsed.toString();
  }

  async doctor() {
    if (!this.enabled) return { ok: true, detail: "disabled" };
    const details: string[] = [];
    try {
      if (existsSync(this.config.pythonExecutable)) {
        const { stdout } = await exec(
          this.config.pythonExecutable,
          [
            "-c",
            "import cloakbrowser,scrapling;print('CloakBrowser + Scrapling ready')",
          ],
          { timeout: 10_000 },
        );
        details.push(stdout.trim());
      } else details.push("Python adapters not installed");
      const { stdout } = await exec(
        this.config.chromiumExecutable,
        ["--version"],
        { timeout: 10_000 },
      );
      details.push(stdout.trim());
      return { ok: true, detail: details.join(" · ") };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private runBridge(request: Record<string, unknown>) {
    return new Promise<{ content: string; backend: string }>(
      (resolve, reject) => {
        const child = spawn(this.config.pythonExecutable, [bridge], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "",
          stderr = "";
        const timer = setTimeout(
          () => child.kill("SIGKILL"),
          this.config.timeoutSeconds * 1000 + 5000,
        );
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          clearTimeout(timer);
          try {
            const result = JSON.parse(stdout);
            code === 0 && result.ok
              ? resolve(result)
              : reject(
                  new Error(
                    result.error || stderr || `Python bridge exited ${code}`,
                  ),
                );
          } catch {
            reject(
              new Error(stderr || stdout || "Invalid browser bridge response"),
            );
          }
        });
        child.stdin.end(
          JSON.stringify({ ...request, timeout: this.config.timeoutSeconds }),
        );
      },
    );
  }

  async open(
    url: string,
    backend: "auto" | "cloak" | "scrapling" | "chromium" = this.config.backend,
    selector?: string,
  ) {
    if (!this.enabled) throw new Error("Browser tools are disabled");
    const safeUrl = await this.validate(url);
    const selected =
      backend === "auto"
        ? existsSync(this.config.pythonExecutable)
          ? "cloak"
          : "chromium"
        : backend;
    if (selected === "chromium") {
      const { stdout } = await exec(
        this.config.chromiumExecutable,
        ["--headless=new", "--disable-gpu", "--dump-dom", safeUrl],
        { timeout: this.config.timeoutSeconds * 1000, maxBuffer: 2_000_000 },
      );
      return stdout
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50_000);
    }
    return (
      await this.runBridge({
        backend: selected,
        url: safeUrl,
        selector,
        stealth: selected === "scrapling",
      })
    ).content;
  }
}
