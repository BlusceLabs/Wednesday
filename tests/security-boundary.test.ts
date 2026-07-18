import { describe, expect, test } from "bun:test";
import { BrowserUse, robotsDisallows } from "../src/browser/use";
import { PermissionService } from "../src/core/permissions";

describe("BrowserUse.validate SSRF policy", () => {
  const browser = new BrowserUse({
    enabled: true,
    backend: "chromium",
    chromiumExecutable: "chromium",
    pythonExecutable: "",
    respectRobots: false,
    allowPrivateHosts: false,
    timeoutSeconds: 5,
  });

  test("blocks private/loopback hosts", async () => {
    await expect(
      browser.validate("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow();
    await expect(browser.validate("http://127.0.0.1/")).rejects.toThrow();
    await expect(browser.validate("http://10.0.0.5/")).rejects.toThrow();
  });

  test("blocks non-http(s) schemes", async () => {
    await expect(browser.validate("ftp://example.com/")).rejects.toThrow();
  });

  test("allows public hosts", async () => {
    // 1.1.1.1 resolves without network and is not in any private range.
    await expect(browser.validate("http://1.1.1.1/")).resolves.toBeDefined();
  });
});

describe("robotsDisallows", () => {
  test("honors Disallow prefixes", () => {
    const robots =
      "User-agent: *\nDisallow: /private\nDisallow: /secret/";
    expect(robotsDisallows(robots, "/private/x")).toBe(true);
    expect(robotsDisallows(robots, "/secret/y")).toBe(true);
    expect(robotsDisallows(robots, "/public")).toBe(false);
  });
});

describe("PermissionService.check", () => {
  test("allows read-only, allow-listed, and safe-prefixed tools", async () => {
    const ps = new PermissionService();
    expect(await ps.check("memory_search", {})).toBeUndefined();
    expect(await ps.check("computer_write_file", {})).toBeUndefined();
    expect(await ps.check("text_uppercase", {})).toBeUndefined();
    expect(await ps.check("git_status", {})).toBeUndefined();
  });

  test("blocks unknown tools", async () => {
    const ps = new PermissionService();
    expect(await ps.check("mystery_tool", {})).toEqual({
      block: true,
      reason: expect.any(String),
    });
  });

  test("refuses git push/pull to an unconfigured remote", async () => {
    const ps = new PermissionService({
      gitRemote: "git@github.com:me/wednesday-memory.git",
    });
    expect(
      await ps.check("git_push", { remote: "git@evil.example.com:x.git" }),
    ).toEqual({ block: true, reason: expect.any(String) });
    // No remote argument → uses the configured remote → allowed.
    expect(await ps.check("git_push", {})).toBeUndefined();
  });
});
