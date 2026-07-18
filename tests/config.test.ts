import { describe, expect, test } from "bun:test";
import { defaultSettings, validateSettings } from "../src/core/config";

describe("production configuration", () => {
  test("defaults to safe local settings", () => {
    const settings = defaultSettings();
    expect(settings.server.host).toBe("127.0.0.1");
    expect(settings.browser.allowPrivateHosts).toBe(false);
    expect(settings.browser.respectRobots).toBe(true);
    expect(settings.sandbox.enabled).toBe(false);
  });

  test("defaults maximize the connected model (deep reasoning, auto output ceiling)", () => {
    const settings = defaultSettings();
    expect(settings.model.thinkingLevel).toBe("high");
    expect(settings.model.maxOutputTokens).toBe("auto");
    expect(validateSettings(settings).ok).toBe(true);
  });

  test("rejects invalid model tuning values", () => {
    const settings = defaultSettings();
    settings.model.temperature = 5;
    const result = validateSettings(settings);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes("temperature"))).toBe(
      true,
    );
  });

  test("rejects an unknown thinking level", () => {
    const settings = defaultSettings();
    // @ts-expect-error intentionally invalid for the test
    settings.model.thinkingLevel = "ludicrous";
    const result = validateSettings(settings);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes("thinkingLevel"))).toBe(
      true,
    );
  });
});
