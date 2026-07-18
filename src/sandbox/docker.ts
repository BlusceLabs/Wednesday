import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { SandboxConfig } from "../core/config";

const exec = promisify(execFile);
const OUTPUT_LIMIT = 100_000;

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export class DockerSandbox {
  readonly enabled: boolean;

  constructor(private readonly config: SandboxConfig) {
    this.enabled = config.enabled;
  }

  async doctor() {
    if (!this.enabled) return { ok: true, detail: "disabled" };
    try {
      await exec("docker", ["info"], { timeout: 10_000 });
      await exec("docker", ["image", "inspect", this.config.image], {
        timeout: 10_000,
      });
      return {
        ok: true,
        detail: `${this.config.image} · ${this.config.workspace}`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async run(command: string, timeoutSeconds = 30): Promise<SandboxResult> {
    if (!this.enabled) throw new Error("Docker sandbox is disabled");
    const timeoutMs = Math.min(Math.max(timeoutSeconds, 1), 120) * 1000;
    const name = `wednesday-${randomUUID().slice(0, 12)}`;
    const args = [
      "run",
      "--rm",
      "--name",
      name,
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "256",
      "--memory",
      `${this.config.memoryMb}m`,
      "--cpus",
      String(this.config.cpus),
      "-v",
      `${this.config.workspace}:/workspace:rw`,
      "-w",
      "/workspace",
      this.config.image,
      "sh",
      "-lc",
      command,
    ];

    return new Promise<SandboxResult>((resolvePromise, reject) => {
      const child = spawn("docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const append = (current: string, chunk: Buffer) =>
        (current + chunk.toString()).slice(-OUTPUT_LIMIT);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", reject);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        void exec("docker", ["rm", "-f", name]).catch(() => undefined);
      }, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }
}
