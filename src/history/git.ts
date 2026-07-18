import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative } from "node:path";

const exec = promisify(execFile);

export class GitHistory {
  constructor(
    private readonly root: string,
    private readonly enabled: boolean,
  ) {}

  private async git(args: string[]) {
    return exec("git", ["-C", this.root, ...args], { maxBuffer: 1024 * 1024 });
  }

  async initialize() {
    if (!this.enabled) return;
    try {
      await this.git(["rev-parse", "--git-dir"]);
    } catch {
      await exec("git", ["init", this.root]);
    }
    try {
      await this.git(["config", "user.name"]);
    } catch {
      await this.git(["config", "user.name", "Wednesday"]);
    }
    try {
      await this.git(["config", "user.email"]);
    } catch {
      await this.git(["config", "user.email", "wednesday@local"]);
    }
  }

  async commit(path: string, message: string) {
    if (!this.enabled) return null;
    const file = relative(this.root, path);
    await this.git(["add", "--", file]);
    try {
      await this.git(["commit", "-m", message, "--", file]);
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (
        text.includes("nothing to commit") ||
        text.includes("no changes added")
      )
        return false;
      throw error;
    }
  }

  async log(limit = 8) {
    if (!this.enabled) return [];
    try {
      const { stdout } = await this.git([
        "log",
        `-${limit}`,
        "--pretty=format:%h|%ad|%s",
        "--date=short",
      ]);
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}
