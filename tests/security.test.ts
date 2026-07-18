import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { BrowserUse } from "../src/browser/use";
import { createComputerTools } from "../src/agent/computer-tools";
import { createExtendedTools } from "../src/agent/extended-tools";
import { DockerSandbox } from "../src/sandbox/docker";
import { resolveInside } from "../src/agent/paths";

describe("workspace path confinement", () => {
  test("resolveInside keeps paths inside the workspace", () => {
    expect(resolveInside("/workspace", "a/b/c.md")).toBe(
      "/workspace/a/b/c.md",
    );
    expect(resolveInside("/workspace", ".")).toBe("/workspace");
  });

  test("resolveInside rejects paths that escape the workspace", () => {
    expect(() => resolveInside("/workspace", "../etc/passwd")).toThrow(
      "Path escapes workspace",
    );
    expect(() => resolveInside("/workspace", "/etc/passwd")).toThrow(
      "Path escapes workspace",
    );
    expect(() =>
      resolveInside("/workspace", "sub/../../etc/passwd"),
    ).toThrow("Path escapes workspace");
  });
});

describe("computer_apply_patch confinement", () => {
  let workspace = "";
  afterEach(async () => workspace && rm(workspace, { recursive: true, force: true }));

  test("rejects patches whose targets escape the workspace", async () => {
    workspace = await mkdtemp(join(tmpdir(), "wednesday-patch-"));
    const sandbox = new DockerSandbox({
      enabled: false,
      image: "none",
      workspace,
      memoryMb: 128,
      cpus: 1,
    });
    const applyPatch = createComputerTools(sandbox, workspace).find(
      (t) => t.name === "computer_apply_patch",
    ) as unknown as {
      execute: (id: string, params: { patch: string }) => Promise<unknown>;
    };
    const escapePatch = [
      "diff --git a/../evil b/../evil",
      "--- a/../evil",
      "+++ b/../../tmp/evil.txt",
      "@@ -0,0 +1,1 @@",
      "+pwned",
    ].join("\n");
    // Validation must throw before any `git apply` runs, so no git/docker
    // is contacted for a malicious patch.
    await expect(
      applyPatch.execute("id", { patch: escapePatch }),
    ).rejects.toThrow("Path escapes workspace");
  });
});

describe("browser_screenshot policy", () => {
  test("routes through the shared browser guard (SSRF/robots)", async () => {
    const browser = {
      enabled: true,
      chromiumExecutable: "chromium",
      validate: async (_url: string) => {
        throw new Error("blocked by private-host policy");
      },
      open: async () => "",
    } as unknown as BrowserUse;
    const tools = createExtendedTools(browser, "/workspace", {
      gitRemote: null,
      voice: { enabled: false, engine: "auto", rate: 1 },
      integrations: {
        calendar: { provider: "none" },
        email: { provider: "none" },
      },
      modelCapabilities: { vision: false },
      home: "/home/wednesday",
    });
    const screenshot = tools.find(
      (t) => t.name === "browser_screenshot",
    ) as unknown as {
      execute: (id: string, params: { url: string }) => Promise<unknown>;
    };
    // A private/loopback target must be refused by the shared guard rather
    // than bypassing it (the original pre-fix code only checked http(s)).
    await expect(
      screenshot.execute("id", {
        url: "http://169.254.169.254/latest/meta-data/",
      }),
    ).rejects.toThrow("blocked by private-host policy");
  });
});
