import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownVault } from "../src/memory/vault";

let root = "";
afterEach(async () => root && rm(root, { recursive: true, force: true }));

describe("MarkdownVault", () => {
  test("writes an Obsidian-compatible memory", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-vault-"));
    const vault = new MarkdownVault(root);
    await vault.initialize();
    const memory = await vault.remember({
      title: "Wednesday Foundation",
      body: "Pi is Wednesday's brain.",
      type: "decision",
      tags: ["wednesday/architecture"],
    });
    const markdown = await readFile(memory.path, "utf8");
    expect(markdown).toContain("type: decision");
    expect(markdown).toContain("# Wednesday Foundation");
    expect(markdown).toContain("wednesday/architecture");
  });

  test("dedupes by title and forget/prune removes memories", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-vault-"));
    const vault = new MarkdownVault(root);
    await vault.initialize();
    const a = await vault.remember({ title: "Same Title", body: "first" });
    const b = await vault.remember({ title: "Same Title", body: "second" });
    // Same title -> updated in place, not a duplicate file.
    expect(b.path).toBe(a.path);
    expect((await readFile(b.path, "utf8")).trim().endsWith("second")).toBe(
      true,
    );

    await vault.remember({ title: "Other Memory", body: "x" });
    const listed = await vault.list();
    expect(listed.map((m) => m.title).sort()).toEqual([
      "Other Memory",
      "Same Title",
    ]);

    expect(await vault.forget("Same Title")).toBe(true);
    expect(await vault.forget("Same Title")).toBe(false); // already gone
    const after = await vault.list();
    expect(after.map((m) => m.title)).toEqual(["Other Memory"]);
  });

  test("stats and tags summarize the vault", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-vault-"));
    const vault = new MarkdownVault(root);
    await vault.initialize();
    await vault.remember({
      title: "Architecture",
      body: "Pi is the brain. It is a long body of text used for word counting purposes.",
      type: "decision",
      tags: ["wednesday/architecture", "core"],
    });
    await vault.remember({
      title: "Preference",
      body: "Black coffee.",
      type: "preference",
      tags: ["core"],
    });

    const stats = await vault.stats();
    expect(stats.total).toBe(2);
    expect(stats.byType).toEqual({ decision: 1, preference: 1 });
    expect(stats.byFolder).toEqual({ decisions: 1, preferences: 1 });
    expect(stats.totalWords).toBeGreaterThan(0);
    expect(stats.oldest && stats.newest).toBeTruthy();

    const tags = await vault.tags();
    expect(tags).toEqual([
      { tag: "core", count: 2 },
      { tag: "wednesday/architecture", count: 1 },
    ]);
  });

  test("handles memories with very large bodies via bounded reads", async () => {
    // The body is far bigger than the 16KB head read, so this guards the
    // assumption that titles/tags live at the top of each file.
    root = await mkdtemp(join(tmpdir(), "wednesday-vault-"));
    const vault = new MarkdownVault(root);
    await vault.initialize();
    const bigBody = "word ".repeat(200_000);
    await vault.remember({
      title: "Big Memory",
      body: bigBody,
      type: "knowledge",
      tags: ["bulk"],
    });
    const listed = await vault.list();
    expect(listed[0].title).toBe("Big Memory");
    const stats = await vault.stats();
    expect(stats.total).toBe(1);
    expect(stats.byType).toEqual({ knowledge: 1 });
    // The body is ~400k chars of words; word count should be near 200k.
    expect(stats.totalWords).toBeGreaterThan(150_000);
    expect((await vault.tags())).toEqual([{ tag: "bulk", count: 1 }]);
    const archive = await vault.exportArchive();
    const exported = archive.memories[0];
    expect(exported.title).toBe("Big Memory");
    expect(exported.body.startsWith("# Big Memory")).toBe(true);
    // The full body (including the huge pasted text) is preserved verbatim.
    expect(exported.body.split(/\s+/).filter((w) => w === "word").length).toBe(
      200_000,
    );
    expect(exported.frontmatter).toContain("type: knowledge");
  });
});
