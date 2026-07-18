import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, formatSkillIndex, readSkillFile } from "../src/skills/loader";

async function makeSkill(root: string, dir: string, body: string) {
  const d = join(root, dir);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, "SKILL.md"), body, "utf8");
}

describe("skills loader", () => {
  test("discovers SKILL.md files and parses agentskills.io frontmatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "wed-skills-"));
    try {
      await makeSkill(
        root,
        "commit-style",
        `---\nname: commit-style\ndescription: Write conventional commit messages.\nversion: 1.2.0\nlicense: MIT\n---\n# Commit style\nUse Conventional Commits.\n`,
      );
      await makeSkill(
        root,
        "nested/deep-skill",
        `---\nname: deep-skill\ndescription: A skill in a nested folder.\n---\nBody text.\n`,
      );
      // A non-skill markdown file should be ignored.
      const notesDir = join(root, "notes");
      await mkdir(notesDir, { recursive: true });
      await writeFile(join(notesDir, "README.md"), "# Notes\nnot a skill\n", "utf8");

      const skills = await discoverSkills(root);
      expect(skills).toHaveLength(2);
      const commit = skills.find((s) => s.name === "commit-style")!;
      expect(commit.description).toBe("Write conventional commit messages.");
      expect(commit.version).toBe("1.2.0");
      expect(commit.license).toBe("MIT");
      expect(commit.content).toContain("Conventional Commits");
      expect(commit.path.endsWith(join("commit-style", "SKILL.md"))).toBe(true);
      // Sorted by name: commit-style before deep-skill.
      expect(skills[0].name).toBe("commit-style");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns an empty list for a missing root", async () => {
    const skills = await discoverSkills("/nonexistent/wednesday/skills/xyz");
    expect(skills).toEqual([]);
  });

  test("formatSkillIndex renders a discoverable prompt section", () => {
    const idx = formatSkillIndex([
      { name: "a", description: "does a", version: "1.0.0", path: "/s/a/SKILL.md" } as never,
    ]);
    expect(idx).toContain("Skills available to you");
    expect(idx).toContain("a: does a");
    expect(idx).toContain("/s/a/SKILL.md");
    expect(formatSkillIndex([])).toBe("");
  });

  test("readSkillFile falls back to the title when name is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "wed-skills-"));
    try {
      await makeSkill(root, "untitled", "# My Heading\nNo frontmatter here.\n");
      const skill = await readSkillFile(join(root, "untitled", "SKILL.md"));
      expect(skill?.name).toBe("My Heading");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
