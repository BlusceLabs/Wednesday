import { describe, expect, test } from "bun:test";
import { computerToolCount } from "../src/agent/computer-tools";
import { extendedToolCount } from "../src/agent/extended-tools";
import { utilityToolCount } from "../src/agent/utility-tools";

describe("tool registry", () => {
  test("ships at least 80 core tools", () => {
    expect(
      3 + utilityToolCount + extendedToolCount + computerToolCount,
    ).toBeGreaterThanOrEqual(80);
  });

  test("ships all four computer tools", () => {
    expect(computerToolCount).toBe(4);
  });
});
