import { resolve, sep } from "node:path";

/**
 * Resolve `path` against a workspace root and assert it stays inside it.
 *
 * This is the single source of truth for the workspace confinement boundary
 * used by every file-manipulating tool. Centralizing it (instead of each
 * tool re-implementing the `resolve` + `startsWith(root + sep)` check)
 * makes the boundary impossible to forget — `computer_apply_patch` had
 * previously skipped it entirely because it operated on raw patch text
 * rather than a single resolved path.
 *
 * Throws if the resolved path escapes the workspace root.
 */
export function resolveInside(root: string, path = "."): string {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep))
    throw new Error("Path escapes workspace");
  return full;
}
