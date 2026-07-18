import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownVault } from "../src/memory/vault";
import {
  parseArchive,
  stringifyArchive,
  type VaultArchive,
} from "../src/memory/archive";

let root = "";
afterEach(async () => root && rm(root, { recursive: true, force: true }));

async function freshVault() {
  root = await mkdtemp(join(tmpdir(), "wednesday-archive-"));
  const vault = new MarkdownVault(root);
  await vault.initialize();
  return vault;
}

describe("vault export / import", () => {
  test("round-trips memories through an archive", async () => {
    const vault = await freshVault();
    await vault.remember({
      title: "Wednesday Foundation",
      body: "Pi is Wednesday's brain.",
      type: "decision",
      tags: ["wednesday/architecture"],
    });
    await vault.remember({
      title: "Coffee preference",
      body: "Black, no sugar.",
      type: "preference",
    });

    const archive = await vault.exportArchive();
    expect(archive.count).toBe(2);
    expect(archive.memories.every((m) => m.folder && m.frontmatter)).toBe(true);
    // Round-trip through serialized bytes, like a file would.
    const serialized = stringifyArchive(archive);
    const parsed = parseArchive(serialized);
    expect(parsed.memories).toHaveLength(2);

    // Wipe and re-import into a brand-new vault.
    await rm(root, { recursive: true, force: true });
    const restored = await freshVault();
    const result = await restored.importArchive(parsed);
    expect(result).toEqual({ imported: 2, updated: 0, skipped: 0 });

    const titles = (await restored.list()).map((m) => m.title).sort();
    expect(titles).toEqual(["Coffee preference", "Wednesday Foundation"]);
  });

  test("'add' mode is non-destructive on re-import", async () => {
    const vault = await freshVault();
    await vault.remember({ title: "Keep me", body: "original" });
    const archive = await vault.exportArchive();

    // Import again unchanged -> everything skipped, nothing duplicated.
    const first = await vault.importArchive(archive);
    expect(first).toEqual({ imported: 0, updated: 0, skipped: 1 });
    expect((await vault.list()).map((m) => m.title)).toEqual(["Keep me"]);

    // 'merge' mode overwrites the existing memory with the backup's body.
    const archive2: VaultArchive = {
      ...archive,
      memories: [
        {
          folder: archive.memories[0].folder,
          title: "Keep me",
          frontmatter: archive.memories[0].frontmatter,
          body: "# Keep me\n\nrestored",
        },
      ],
    };
    const second = await vault.importArchive(archive2, { mode: "merge" });
    expect(second).toEqual({ imported: 0, updated: 1, skipped: 0 });
    const file = (await vault.list())[0].path;
    expect(await readFile(file, "utf8")).toContain("restored");
  });

  test("parseArchive rejects non-vault JSON", () => {
    expect(() => parseArchive('{"hello":"world"}')).toThrow(
      /not a Wednesday vault export/,
    );
    expect(() => parseArchive("not json")).toThrow(/not valid JSON/);
  });

  test("export/import preserves a named backup file location", async () => {
    const vault = await freshVault();
    await vault.remember({ title: "Backup me", body: "data" });
    const archive = await vault.exportArchive();
    const dir = join(root, "backups");
    const path = join(dir, "wednesday-test.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(path, stringifyArchive(archive), "utf8");
    const read = parseArchive(await readFile(path, "utf8"));
    expect(read.count).toBe(1);
  });
});
