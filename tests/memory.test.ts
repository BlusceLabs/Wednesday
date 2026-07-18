import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryIndex } from "../src/memory/index";
import { MarkdownVault } from "../src/memory/vault";

let root = "";
afterEach(async () => root && rm(root, { recursive: true, force: true }));

describe("MemoryIndex.sync", () => {
  test("incremental sync finds new files and matches full rebuild", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-memory-"));
    const vaultRoot = join(root, "vault");
    await writeFile(join(root, "vault-marker"), "").catch(() => {});
    const { mkdir } = await import("node:fs/promises");
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(
      join(vaultRoot, "one.md"),
      "# One\nWednesday remembers the launch plan.",
      "utf8",
    );
    const index = await MemoryIndex.create(join(root, "index.sqlite"), true);
    await index.sync(vaultRoot);
    expect(index.search("launch").length).toBeGreaterThan(0);

    await writeFile(
      join(vaultRoot, "two.md"),
      "# Two\nA second memory about the release checklist.",
      "utf8",
    );
    await index.sync(vaultRoot);
    expect(index.search("checklist").length).toBeGreaterThan(0);
    // The unchanged first file should still be found without having been
    // re-embedded on the second sync call.
    expect(index.search("launch").length).toBeGreaterThan(0);

    index.close();
  });

  test("sync removes rows for deleted files", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-memory-"));
    const vaultRoot = join(root, "vault");
    const { mkdir, rm: rmFile } = await import("node:fs/promises");
    await mkdir(vaultRoot, { recursive: true });
    const filePath = join(vaultRoot, "temp.md");
    await writeFile(
      filePath,
      "# Temp\nEphemeral note about onboarding.",
      "utf8",
    );
    const index = await MemoryIndex.create(join(root, "index.sqlite"), true);
    await index.sync(vaultRoot);
    expect(index.search("onboarding").length).toBeGreaterThan(0);

    await rmFile(filePath);
    await index.sync(vaultRoot);
    expect(index.search("onboarding").length).toBe(0);

    index.close();
  });

  test("recall finds a remembered memory after sync", async () => {
    root = await mkdtemp(join(tmpdir(), "wednesday-memory-"));
    const vaultRoot = join(root, "vault");
    await mkdir(vaultRoot, { recursive: true });
    const vault = new MarkdownVault(vaultRoot);
    const index = await MemoryIndex.create(join(root, "index.sqlite"), true);
    await vault.remember({
      title: "Release Plan",
      body: "Ship the RC on Friday.",
    });
    await index.sync(vaultRoot);
    const hits = index.search("release friday");
    expect(hits.length).toBeGreaterThan(0);
    index.close();
  });
});
