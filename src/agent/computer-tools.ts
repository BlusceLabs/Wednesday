import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { resolveInside } from "./paths";
import type { DockerSandbox } from "../sandbox/docker";

const exec = promisify(execFile);
const OUTPUT_LIMIT = 50_000;

const editSchema = Type.Object({
  old_string: Type.String(),
  new_string: Type.String(),
  replace_all: Type.Optional(Type.Boolean()),
});

/**
 * Direct computer-use tools: write files, apply precise text edits, apply
 * multi-file unified diffs, and run shell commands against Wednesday's own
 * workspace. These mirror a coding assistant's "computer" tools, are
 * confined to the configured workspace root, and run inside the configured workspace root.
 */
export function createComputerTools(
  sandbox: DockerSandbox,
  workspaceRoot: string,
): AgentTool[] {
  const root = resolve(workspaceRoot);
  const inside = (path: string) => resolveInside(root, path);

  const computerWriteFileParameters = Type.Object({
    path: Type.String({ description: "Workspace-relative file path" }),
    content: Type.String(),
    append: Type.Optional(Type.Boolean()),
  });
  const computerWriteFile: AgentTool<typeof computerWriteFileParameters> = {
    name: "computer_write_file",
    label: "Write file",
    description:
      "Create a file, or replace an existing one, with the text you give me.",
    executionMode: "sequential",
    parameters: computerWriteFileParameters,
    execute: async (_id, params) => {
      const target = inside(params.path);
      await mkdir(dirname(target), { recursive: true });
      if (params.append) {
        const existing = await readFile(target, "utf8").catch(() => "");
        await writeFile(target, existing + params.content, "utf8");
      } else {
        await writeFile(target, params.content, "utf8");
      }
      return {
        content: [
          {
            type: "text",
            text: `${params.append ? "Appended to" : "Wrote"} ${params.path} (${params.content.length} characters).`,
          },
        ],
        details: { path: params.path, append: Boolean(params.append) },
      };
    },
  };

  const computerEditFileParameters = Type.Object({
    path: Type.String({ description: "Workspace-relative file path" }),
    edits: Type.Array(editSchema, { minItems: 1, maxItems: 20 }),
  });
  const computerEditFile: AgentTool<typeof computerEditFileParameters> = {
    name: "computer_edit_file",
    label: "Edit file",
    description:
      "Make precise find-and-replace changes to a file you already have.",
    executionMode: "sequential",
    parameters: computerEditFileParameters,
    execute: async (_id, params) => {
      const target = inside(params.path);
      let text = await readFile(target, "utf8");
      const results: Array<{ replacements: number }> = [];
      for (const edit of params.edits) {
        const count = text.split(edit.old_string).length - 1;
        if (count === 0)
          throw new Error(
            `old_string was not found verbatim in ${params.path}.`,
          );
        if (count > 1 && !edit.replace_all)
          throw new Error(
            `old_string appears ${count} times in ${params.path}. Provide a larger unique string or set replace_all to true.`,
          );
        text = edit.replace_all
          ? text.split(edit.old_string).join(edit.new_string)
          : text.replace(edit.old_string, edit.new_string);
        results.push({ replacements: edit.replace_all ? count : 1 });
      }
      await writeFile(target, text, "utf8");
      return {
        content: [
          {
            type: "text",
            text: `Applied ${params.edits.length} edit(s) to ${params.path}.`,
          },
        ],
        details: { path: params.path, results },
      };
    },
  };

  const computerApplyPatchParameters = Type.Object({
    patch: Type.String({
      minLength: 1,
      description: "Unified diff text covering one or more files",
    }),
  });
  const computerApplyPatch: AgentTool<typeof computerApplyPatchParameters> = {
    name: "computer_apply_patch",
    label: "Apply patch",
    description:
      "Apply a diff (like the ones `git diff` makes) across several files at once — handy for bigger refactors.",
    executionMode: "sequential",
    parameters: computerApplyPatchParameters,
    execute: async (_id, params) => {
      // Reject patches whose target paths escape the workspace. `git apply`
      // writes files relative to the workspace root, so a `../` inside a
      // hunk header would otherwise let a patch create/overwrite files
      // outside it — the one file tool that previously skipped the
      // path-confinement check the other computer tools enforce.
      for (const match of params.patch.matchAll(
        /^(?:---|\+\+\+) (?:a\/|b\/)?(\S+)/gm,
      )) {
        const target = match[1];
        if (target === "/dev/null" || target === "dev/null") continue;
        inside(target);
      }
      const patchFile = resolve(root, `.wednesday-patch-${randomUUID()}.diff`);
      await writeFile(patchFile, params.patch, "utf8");
      try {
        const { stdout, stderr } = await exec(
          "git",
          ["-C", root, "apply", "--whitespace=nowarn", patchFile],
          { timeout: 30_000, maxBuffer: 2_000_000 },
        );
        const output = (stdout + stderr).trim();
        return {
          content: [
            { type: "text", text: output || "Patch applied successfully." },
          ],
          details: { lines: params.patch.split("\n").length },
        };
      } catch (error) {
        const err = error as {
          stdout?: string;
          stderr?: string;
          message: string;
        };
        throw new Error(
          ((err.stdout ?? "") + (err.stderr ?? err.message)).slice(
            0,
            OUTPUT_LIMIT,
          ) || err.message,
        );
      } finally {
        await rm(patchFile, { force: true });
      }
    },
  };

  const computerTerminalParameters = Type.Object({
    command: Type.String({ minLength: 1, maxLength: 4000 }),
    timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
  });
  const computerTerminal: AgentTool<typeof computerTerminalParameters> = {
    name: "computer_terminal",
    label: "Terminal",
    description: sandbox.enabled
      ? "Run a command in the sealed Docker sandbox that's mounted to your workspace."
      : "Run a command right here in your workspace.",
    executionMode: "sequential",
    parameters: computerTerminalParameters,
    execute: async (_id, params) => {
      const timeoutSeconds = params.timeoutSeconds ?? 30;
      if (sandbox.enabled) {
        const result = await sandbox.run(params.command, timeoutSeconds);
        const output = [
          result.stdout && `stdout:\n${result.stdout}`,
          result.stderr && `stderr:\n${result.stderr}`,
          `exit code: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        if (result.exitCode !== 0) throw new Error(output);
        return {
          content: [{ type: "text", text: output }],
          details: { exitCode: result.exitCode, timedOut: result.timedOut },
        };
      }
      try {
        const { stdout, stderr } = await exec("sh", ["-lc", params.command], {
          cwd: root,
          timeout: timeoutSeconds * 1000,
          maxBuffer: 5_000_000,
        });
        const output = (stdout + stderr).slice(0, OUTPUT_LIMIT);
        return {
          content: [{ type: "text", text: output || "(no output)" }],
          details: { exitCode: 0 },
        };
      } catch (error) {
        const err = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          message: string;
        };
        const output = ((err.stdout ?? "") + (err.stderr ?? err.message)).slice(
          0,
          OUTPUT_LIMIT,
        );
        throw new Error(output || err.message);
      }
    },
  };

  return [
    computerWriteFile,
    computerEditFile,
    computerApplyPatch,
    computerTerminal,
  ];
}

export const computerToolCount = 4;
