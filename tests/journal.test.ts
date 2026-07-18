import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventJournal } from "../src/core/journal";

let root = "";
afterEach(async () => root && rm(root, { recursive: true, force: true }));

describe("EventJournal", () => {
  test("hash-chains events", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-journal-"));
    const path = join(root, "events.jsonl");
    const journal = new EventJournal(path);
    await journal.initialize();
    const first = await journal.append({
      type: "one",
      actor: "system",
      payload: {},
    });
    const second = await journal.append({
      type: "two",
      actor: "system",
      payload: {},
    });
    expect(second.previousHash).toBe(first.hash);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test("verify() passes for an intact chain", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-journal-"));
    const path = join(root, "events.jsonl");
    const journal = new EventJournal(path);
    await journal.initialize();
    await journal.append({ type: "one", actor: "system", payload: {} });
    await journal.append({ type: "two", actor: "system", payload: {} });
    const result = await journal.verify();
    expect(result.ok).toBe(true);
    expect(result.entries).toBe(2);
  });

  test("verify() flags a tampered entry", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-journal-"));
    const path = join(root, "events.jsonl");
    const journal = new EventJournal(path);
    await journal.initialize();
    await journal.append({ type: "one", actor: "system", payload: {} });
    await journal.append({ type: "two", actor: "system", payload: {} });
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const corrupted = JSON.parse(lines[0]);
    corrupted.payload = { evil: true };
    lines[0] = JSON.stringify(corrupted);
    await writeFile(path, lines.join("\n") + "\n", "utf8");
    const result = await journal.verify();
    expect(result.ok).toBe(false);
    expect(result.firstBad).toBe(1);
  });

  test("concurrent appends stay correctly hash-chained", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-journal-"));
    const path = join(root, "events.jsonl");
    const journal = new EventJournal(path);
    await journal.initialize();
    // Fire 50 appends at once (mirrors prompt.accepted overlapping the
    // model call while tool events also append). The journal must serialize
    // them so the hash chain remains valid and in submission order.
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        journal.append({ type: `e${i}`, actor: "system", payload: { i } }),
      ),
    );
    const result = await journal.verify();
    expect(result.ok).toBe(true);
    expect(result.entries).toBe(50);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(50);
  });
});
