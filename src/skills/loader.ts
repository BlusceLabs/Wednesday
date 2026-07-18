import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, resolve } from "node:path";

export interface Skill {
  name: string;
  description: string;
  version?: string;
  license?: string;
  dir: string;
  path: string;
  content: string;
}

/**
 * Parse the YAML-ish frontmatter at the top of a SKILL.md file
 * (agentskills.io format). Only the scalar fields the spec uses are
 * extracted: name, description, version, license.
 */
function parseFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    meta[m[1]] = v;
  }
  return { meta, body: match[2] };
}

export async function readSkillFile(path: string): Promise<Skill | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(text);
  const name =
    meta.name || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || "unnamed";
  return {
    name,
    description: meta.description || "",
    version: meta.version || undefined,
    license: meta.license || undefined,
    dir: resolve(path, ".."),
    path,
    content: body.trim(),
  };
}

/**
 * Discover every skill under `root` by finding SKILL.md files. Skills are
 * directories containing a SKILL.md; we walk recursively (bounded depth)
 * and return them sorted by name. A missing root yields an empty list.
 */
export async function discoverSkills(root: string): Promise<Skill[]> {
  const out: Skill[] = [];
  async function walk(dir: string, depth: number) {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 6) await walk(full, depth + 1);
      } else if (entry.name === "SKILL.md") {
        const skill = await readSkillFile(full);
        if (skill) out.push(skill);
      }
    }
  }
  await walk(root, 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the system-prompt section that makes installed skills discoverable. */
export function formatSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map(
    (s) =>
      `- ${s.name}: ${s.description}${s.version ? ` (v${s.version})` : ""} — read ${s.path} to follow it`,
  );
  return `\n\nSkills available to you (read the SKILL.md file to use one):\n${lines.join("\n")}`;
}
