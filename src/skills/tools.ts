import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

/**
 * The agentskills.io model: skills are SKILL.md files the agent reads on
 * demand. This single read-only tool lets Wednesday open a skill's
 * instructions, confined to the skills directory so a crafted path can't
 * reach files elsewhere on disk.
 */
export function createSkillTools(skillsDir: string): AgentTool[] {
  const skillReadParameters = Type.Object({ path: Type.String() });
  const skillRead: AgentTool<typeof skillReadParameters> = {
    name: "skill_read",
    label: "Read a skill",
    description:
      "Open a skill's SKILL.md instructions so you can follow them. `path` is relative to the skills directory (e.g. `my-skill/SKILL.md`).",
    parameters: skillReadParameters,
    execute: async (_id, params) => {
      const base = resolve(skillsDir);
      const full = resolve(base, params.path);
      if (full !== base && !full.startsWith(base + sep))
        throw new Error("Skill path escapes the skills directory");
      const text = await readFile(full, "utf8");
      const limited =
        text.length > 30_000 ? `${text.slice(0, 30_000)}\n\n[truncated]` : text;
      return {
        content: [{ type: "text", text: limited }],
        details: { path: params.path, characters: text.length },
      };
    },
  };
  return [skillRead];
}
