import { randomUUID } from "node:crypto";
import { access, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { VaultArchive, VaultMemoryEntry } from "./archive";

export interface MemoryInput {
  title: string;
  body: string;
  type?: "knowledge" | "preference" | "decision" | "person" | "project";
  tags?: string[];
  sensitivity?: "public" | "personal" | "private" | "secret";
  sourceRef?: string;
}

const folders = [
  "00-system",
  "people",
  "projects",
  "goals",
  "preferences",
  "decisions",
  "knowledge",
  "experiences",
  "procedures",
  "conversations",
  "daily",
  "inbox",
  "archive",
  "attachments",
];

const folderForType = {
  preference: "preferences",
  decision: "decisions",
  person: "people",
  project: "projects",
  knowledge: "knowledge",
} as const;

function safeName(value: string) {
  return value
    .replace(/[<>:\"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `fn` over `items` with a bounded number of concurrent tasks (never
 * more than `limit` in flight at once). Keeps multi-file vault scans fast
 * without exhausting file descriptors on large vaults.
 */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export class MarkdownVault {
  constructor(readonly root: string) {}

  async initialize() {
    await Promise.all(
      folders.map((folder) =>
        mkdir(join(this.root, folder), { recursive: true }),
      ),
    );
  }

  // Lazily yield every memory file's absolute path, one folder at a time.
  // Single source of the folder walk so list()/stats()/tags()/exportArchive()
  // each do one pass over the vault instead of re-scanning separately.
  private async *files(): AsyncGenerator<string> {
    for (const folder of folders) {
      let entries: string[];
      try {
        entries = await readdir(join(this.root, folder));
      } catch {
        continue;
      }
      for (const name of entries)
        if (name.endsWith(".md")) yield join(this.root, folder, name);
    }
  }

  // Read only the leading bytes of a memory file. Frontmatter and the first
  // Markdown heading always sit at the top, so this is enough to extract the
  // title/tags without dragging a (potentially very large) pasted body into
  // memory — list(), findByTitle(), and tags() never need the body.
  private async readHead(path: string, maxBytes = 16 * 1024): Promise<string> {
    const handle = await open(path, "r");
    try {
      const buffer = new Uint8Array(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return new TextDecoder().decode(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  async remember(input: MemoryInput) {
    const id = `mem_${randomUUID()}`;
    const now = new Date().toISOString();
    const type = input.type ?? "knowledge";
    const folder = folderForType[type];
    const baseName = safeName(input.title);
    // Update an existing memory with the same title in place rather than
    // spinning up yet another file (keeps the vault free of duplicates).
    const existing = await this.findByTitle(join(this.root, folder), input.title);
    let path: string;
    if (existing) path = existing;
    else {
      path = join(this.root, folder, `${baseName}.md`);
      if (await exists(path))
        path = join(this.root, folder, `${baseName} ${id.slice(-8)}.md`);
    }
    const temporary = `${path}.tmp`;
    // Ensure the target folder exists before writing the temp file, so
    // remember() is self-contained and doesn't silently depend on a prior
    // initialize() call (which is what prepares the per-type subfolders).
    await mkdir(dirname(path), { recursive: true });
    const tags = input.tags ?? [];
    const frontmatter = [
      "---",
      `id: ${id}`,
      `type: ${type}`,
      `created: ${now}`,
      `updated: ${now}`,
      "status: active",
      "confidence: 1",
      `sensitivity: ${input.sensitivity ?? "private"}`,
      "source_type: conversation",
      `source_ref: ${input.sourceRef ?? "manual"}`,
      "tags:",
      ...tags.map((tag) => `  - ${tag}`),
      "---",
      "",
    ].join("\n");
    await writeFile(
      temporary,
      `${frontmatter}# ${input.title}\n\n${input.body.trim()}\n`,
      "utf8",
    );
    await rename(temporary, path);
    return { id, path };
  }

  /**
   * Find a memory file in `folder` whose Markdown heading matches `title`
   * (case-insensitive). Returns its absolute path, or null.
   */
  private async findByTitle(
    folder: string,
    title: string,
  ): Promise<string | null> {
    try {
      for (const name of await readdir(folder)) {
        if (!name.endsWith(".md")) continue;
        // Only the heading (at the top) is needed to match, so read a
        // bounded prefix instead of the whole file — important when a
        // memory holds a large pasted body.
        const heading = (await this.readHead(join(folder, name))).match(
          /^#\s+(.+)$/m,
        )?.[1]?.trim();
        if (heading && heading.toLowerCase() === title.toLowerCase())
          return join(folder, name);
      }
    } catch {}
    return null;
  }

  /** Delete a memory by its title (case-insensitive heading match). */
  async forget(title: string): Promise<boolean> {
    for (const folder of folders) {
      const found = await this.findByTitle(join(this.root, folder), title);
      if (found) {
        await rm(found, { force: true });
        return true;
      }
    }
    return false;
  }

  /**
   * List every memory with its title and absolute path. Titles live in the
   * file's first heading, so each file is read with a bounded `readHead`
   * (not the full body) and the walk + reads are parallelized.
   */
  async list(): Promise<Array<{ title: string; path: string }>> {
    const paths: string[] = [];
    for await (const path of this.files()) paths.push(path);
    const heads = await pool(paths, 16, (path) => this.readHead(path));
    return paths.map((path, index) => ({
      title: heads[index].match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(path),
      path,
    }));
  }

  /**
   * Produce a portable, self-contained snapshot of every memory in the
   * vault (frontmatter + body), preserving each memory's folder and title
   * so it can be restored elsewhere with `importArchive`. This is the
   * read-only half of Wednesday's local-first backup/restore story — pair
   * it with `/import` (or the `memory_import` tool) to move or restore a
   * vault without relying on Git remote sync.
   */
  async exportArchive(): Promise<VaultArchive> {
    const paths: string[] = [];
    for await (const path of this.files()) paths.push(path);
    // One bounded fan-out over the vault instead of list() + a second full
    // read per file; the body is needed verbatim, so we read each file once.
    const texts = await pool(paths, 16, (path) => readFile(path, "utf8"));
    const memories: VaultMemoryEntry[] = paths.map((path, index) => {
      const text = texts[index];
      const match = text.match(/^---\n[\s\S]*?\n---\n?/);
      const frontmatter = match ? match[0] : "";
      const body = match ? text.slice(match[0].length) : text;
      const folder = relative(this.root, dirname(path)) || "inbox";
      const title =
        text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(path);
      return { folder, title, frontmatter, body };
    });
    return {
      format: "wednesday-vault",
      version: 1,
      exportedAt: new Date().toISOString(),
      root: this.root,
      count: memories.length,
      memories,
    };
  }

  /**
   * Restore memories from a `VaultArchive` produced by `exportArchive`.
   * Each entry is placed back in its original folder (falling back to
   * `inbox` for unknown/unsafe folders) using the same title-dedup and
   * atomic temp-file write path as `remember`.
   *
   * - `mode: "add"` (default) is non-destructive: memories whose title
   *   already exists in the target folder are skipped, so re-importing a
   *   backup never overwrites memories you've since changed.
   *   Returns those as `skipped`.
   * - `mode: "merge"` overwrites an existing memory with the same title,
   *   counted as `updated`.
   */
  async importArchive(
    archive: VaultArchive,
    options: { mode?: "add" | "merge" } = {},
  ): Promise<{ imported: number; updated: number; skipped: number }> {
    const mode = options.mode ?? "add";
    const result = { imported: 0, updated: 0, skipped: 0 };
    for (const entry of archive.memories) {
      const folder =
        entry.folder &&
        !entry.folder.includes("..") &&
        entry.folder.length < 64
          ? entry.folder
          : "inbox";
      const targetDir = join(this.root, folder);
      await mkdir(targetDir, { recursive: true });
      const existing = await this.findByTitle(targetDir, entry.title);
      const content = entry.frontmatter + entry.body;
      if (existing) {
        if (mode === "add") {
          result.skipped++;
          continue;
        }
        await this.writeRaw(existing, content);
        result.updated++;
        continue;
      }
      const baseName = safeName(entry.title);
      let path = join(targetDir, `${baseName}.md`);
      if (await exists(path))
        path = join(targetDir, `${baseName}-${randomUUID().slice(-8)}.md`);
      await this.writeRaw(path, content);
      result.imported++;
    }
    return result;
  }

  private async writeRaw(path: string, content: string) {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  }

  /**
   * Lightweight vault analytics for the `/stats` command and `memory_stats`
   * tool: how many memories there are, how they break down by type and
   * folder, roughly how much prose they hold, plus the oldest and newest
   * entries (by file mtime). Read-only — no writes, safe to call often.
   */
  async stats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byFolder: Record<string, number>;
    totalWords: number;
    oldest: { title: string; path: string; ageDays: number } | null;
    newest: { title: string; path: string; ageDays: number } | null;
  }> {
    const paths: string[] = [];
    for await (const path of this.files()) paths.push(path);
    // Read each file and stat it once, fanned out concurrently; the body is
    // needed for the word count, so we can't use the bounded head here, but
    // this collapses list() + readFile + stat into a single pass per file.
    const entries = await pool(paths, 16, async (path) => {
      const [text, info] = await Promise.all([
        readFile(path, "utf8"),
        stat(path),
      ]);
      return { path, text, mtimeMs: info.mtimeMs };
    });
    const byType: Record<string, number> = {};
    const byFolder: Record<string, number> = {};
    let totalWords = 0;
    let total = 0;
    let oldest: { title: string; path: string; ageDays: number } | null = null;
    let newest: { title: string; path: string; ageDays: number } | null = null;
    for (const { path, text, mtimeMs } of entries) {
      total++;
      const frontmatter = parseFrontmatter(text);
      const body = text.replace(/^---[\s\S]*?---\n?/, "");
      totalWords += body.trim() ? body.trim().split(/\s+/).length : 0;
      const type = frontmatter.type ?? "unknown";
      byType[type] = (byType[type] ?? 0) + 1;
      const folder = relative(this.root, dirname(path)) || "inbox";
      byFolder[folder] = (byFolder[folder] ?? 0) + 1;
      const ageDays = Math.floor((Date.now() - mtimeMs) / 86_400_000);
      const title =
        text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(path);
      if (!oldest || ageDays > oldest.ageDays)
        oldest = { title, path, ageDays };
      if (!newest || ageDays < newest.ageDays)
        newest = { title, path, ageDays };
    }
    return { total, byType, byFolder, totalWords, oldest, newest };
  }

  /**
   * Aggregate every tag used across the vault (from each memory's
   * frontmatter `tags:` list), most-used first. Powers the `/tags` command
   * and `memory_tags` tool so the user can see how their knowledge is
   * organized at a glance.
   */
  async tags(): Promise<Array<{ tag: string; count: number }>> {
    const paths: string[] = [];
    for await (const path of this.files()) paths.push(path);
    // Tags live in the frontmatter at the top of each file, so a bounded
    // head read (parallelized) is enough — no need to load every body.
    const heads = await pool(paths, 16, (path) => this.readHead(path));
    const counts = new Map<string, number>();
    for (const head of heads) {
      for (const tag of parseFrontmatter(head).tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
}

/**
 * Parse the YAML-ish frontmatter block at the top of a memory file. Only
 * the two fields the insights commands care about are extracted: `type`
 * (a scalar) and `tags` (either inline `[a, b]` or a block list). Kept
 * deliberately minimal — a full YAML parser would be overkill for reading
 * two known keys.
 */
function parseFrontmatter(text: string): { type?: string; tags: string[] } {
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return { tags: [] };
  const tags: string[] = [];
  let type: string | undefined;
  let inTags = false;
  for (const line of block[1].split("\n")) {
    if (inTags) {
      const item = line.match(/^\s*-\s+(.+)$/)?.[1]?.trim();
      if (item) tags.push(item);
      else if (line.trim() === "") inTags = false;
      continue;
    }
    const keyValue = line.match(/^([\w-]+):\s*(.*)$/);
    if (!keyValue) continue;
    const key = keyValue[1];
    const value = keyValue[2].trim();
    if (key === "type") type = value;
    else if (key === "tags") {
      if (value) {
        tags.push(
          ...value
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        );
      } else inTags = true;
    }
  }
  return { type, tags };
}
