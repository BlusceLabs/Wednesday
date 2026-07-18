import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, summarizeOlderMessages } from "../src/sessions/store";

let root = "";
afterEach(async () => root && rm(root, { recursive: true, force: true }));

describe("SessionStore", () => {
  test("persists and clears messages", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-session-"));
    const store = new SessionStore(join(root, "current.json"));
    const messages = [
      { role: "user", content: "Hello", timestamp: Date.now() },
    ] as never[];
    await store.save(messages);
    expect(await store.load()).toHaveLength(1);
    await store.clear();
    expect(await store.load()).toHaveLength(0);
  });

  test("summarizeOlderMessages keeps recent and excerpts older", () => {
    const messages = [
      { role: "user", content: "old one" },
      { role: "assistant", content: "old two" },
      { role: "user", content: "recent one" },
      { role: "assistant", content: "recent two" },
    ] as never[];
    const { summary, trimmed, droppedCount } = summarizeOlderMessages(
      messages,
      2,
    );
    expect(droppedCount).toBe(2);
    expect(trimmed).toHaveLength(2);
    expect(summary).toContain("old one");
    expect(summary).toContain("old two");
  });

  test("summarizeOlderMessages is a no-op within keepRecent", () => {
    const messages = [{ role: "user", content: "only" }] as never[];
    const { droppedCount, trimmed } = summarizeOlderMessages(messages, 5);
    expect(droppedCount).toBe(0);
    expect(trimmed).toHaveLength(1);
  });
});
