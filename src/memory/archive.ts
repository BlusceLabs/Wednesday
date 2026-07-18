import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Self-describing tag for a vault export so `parseArchive` can reject
// arbitrary JSON instead of failing obscurely deep inside the importer.
export const VAULT_ARCHIVE_FORMAT = "wednesday-vault";
export const VAULT_ARCHIVE_VERSION = 1;

export interface VaultMemoryEntry {
  // Vault sub-folder the memory lived in (e.g. "knowledge"), used to place
  // it back where it came from on import.
  folder: string;
  title: string;
  // The raw `---\n…\n---\n` frontmatter block (id, type, timestamps, tags).
  frontmatter: string;
  // The Markdown body after the frontmatter, including the `# Title` heading.
  body: string;
}

export interface VaultArchive {
  format: typeof VAULT_ARCHIVE_FORMAT;
  version: number;
  exportedAt: string;
  root: string;
  count: number;
  memories: VaultMemoryEntry[];
}

export function isVaultArchive(value: unknown): value is VaultArchive {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.format === VAULT_ARCHIVE_FORMAT &&
    typeof candidate.version === "number" &&
    Array.isArray(candidate.memories)
  );
}

export function stringifyArchive(archive: VaultArchive): string {
  return JSON.stringify(archive, null, 2) + "\n";
}

/**
 * Parse a vault export from text, validating the shape up front. Throws a
 * clear error on non-JSON or non-vault content so a mis-typed `/import`
 * path surfaces a readable message instead of an opaque cast failure.
 */
export function parseArchive(text: string): VaultArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Export file is not valid JSON");
  }
  if (!isVaultArchive(parsed))
    throw new Error("File is not a Wednesday vault export");
  return parsed;
}

/**
 * Write an archive to `<home>/backups/wednesday-<timestamp>.json` so exports
 * land in a predictable, non-clobbering location that lives alongside the
 * vault itself. Returns the written absolute path.
 */
export async function writeArchiveFile(
  home: string,
  archive: VaultArchive,
): Promise<string> {
  const directory = join(home, "backups");
  await mkdir(directory, { recursive: true });
  const stamp = archive.exportedAt.replace(/[:.]/g, "-");
  const path = join(directory, `wednesday-${stamp}.json`);
  await writeFile(path, stringifyArchive(archive), "utf8");
  return path;
}
