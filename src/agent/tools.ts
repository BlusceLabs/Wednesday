import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Static, Type } from "@earendil-works/pi-ai";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { BrowserUse } from "../browser/use";
import type { EventJournal } from "../core/journal";
import type { GitHistory } from "../history/git";
import type { MemoryIndex } from "../memory/index";
import type { MarkdownVault } from "../memory/vault";
import { parseArchive, writeArchiveFile } from "../memory/archive";
import type { DockerSandbox } from "../sandbox/docker";
import { createComputerTools } from "./computer-tools";
import {
  createExtendedTools,
  type ExtendedToolOptions,
} from "./extended-tools";
import { createUtilityTools } from "./utility-tools";

// Render a `{ key: count }` map as `key 1, key 2` for notices/tools.
function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length
    ? entries.map(([key, value]) => `${key} ${value}`).join(", ")
    : "none";
}

export function createTools(
  index: MemoryIndex,
  vault: MarkdownVault,
  history: GitHistory,
  journal: EventJournal,
  browser: BrowserUse,
  sandbox: DockerSandbox,
  workspace: string,
  extendedOptions: ExtendedToolOptions,
): AgentTool[] {
  // Resolve `path` to an absolute location that stays inside either the
  // user's home or the workspace root. Centralizes the import boundary the
  // same way resolveInside() does for single-root tools, so a crafted
  // export path can't pull in or write files outside Wednesday's data.
  const resolveImportPath = (path: string) => {
    const full = resolve(path);
    for (const root of [extendedOptions.home, workspace]) {
      if (full === root || full.startsWith(root + sep)) return full;
    }
    throw new Error("Import path must be inside your home or workspace");
  };

  const memorySearchParameters = Type.Object({
    query: Type.String(),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 12 })),
  });
  const memorySearch: AgentTool<typeof memorySearchParameters> = {
    name: "memory_search",
    label: "Search memory",
    description:
      "Look through the things you've remembered, to find notes and facts worth using.",
    parameters: memorySearchParameters,
    execute: async (_id, params) => {
      const hits = index.search(params.query, params.limit ?? 6);
      return {
        content: [
          {
            type: "text",
            text: hits.length
              ? hits
                  .map(
                    (hit) => `${hit.title}\n${hit.snippet}\nvault:${hit.path}`,
                  )
                  .join("\n\n")
              : "No matching memories.",
          },
        ],
        details: { hits },
      };
    },
  };

  const memoryReadParameters = Type.Object({ path: Type.String() });
  const memoryRead: AgentTool<typeof memoryReadParameters> = {
    name: "memory_read",
    label: "Read memory",
    description:
      "Open a single note you found with memory_search, so you can read it in full.",
    parameters: memoryReadParameters,
    execute: async (_id, params) => {
      const root = resolve(vault.root);
      const path = resolve(root, params.path);
      if (path !== root && !path.startsWith(root + sep))
        throw new Error("Memory path escapes the vault");
      if (!path.endsWith(".md"))
        throw new Error("Only Markdown memory files can be read");
      const text = await readFile(path, "utf8");
      const limited =
        text.length > 30_000 ? `${text.slice(0, 30_000)}\n\n[truncated]` : text;
      return {
        content: [{ type: "text", text: limited }],
        details: { path: params.path, characters: text.length },
      };
    },
  };

  const memoryRememberParameters = Type.Object({
    title: Type.String({ description: "Short descriptive title" }),
    body: Type.String({ description: "Clear durable memory text" }),
    type: Type.Optional(
      Type.Union([
        Type.Literal("knowledge"),
        Type.Literal("preference"),
        Type.Literal("decision"),
        Type.Literal("person"),
        Type.Literal("project"),
      ]),
    ),
    tags: Type.Optional(Type.Array(Type.String())),
    sensitivity: Type.Optional(
      Type.Union([
        Type.Literal("public"),
        Type.Literal("personal"),
        Type.Literal("private"),
      ]),
    ),
  });
  const memoryRemember: AgentTool<typeof memoryRememberParameters> = {
    name: "memory_remember",
    label: "Remember",
    description:
      "Save something you'd like to remember for next time.",
    executionMode: "sequential",
    parameters: memoryRememberParameters,
    execute: async (_id, params) => {
      const memory = await vault.remember({
        title: params.title,
        body: params.body,
        type: params.type,
        tags: params.tags,
        sensitivity: params.sensitivity,
        sourceRef: "agent-approved",
      });
      await index.sync(vault.root);
      await history.commit(memory.path, `Remember: ${params.title}`);
      await journal.append({
        type: "memory.committed",
        actor: "wednesday",
        payload: memory,
      });
      return {
        content: [
          { type: "text", text: `Saved durable memory “${params.title}”.` },
        ],
        details: memory,
      };
    },
  };

  const memoryExportParameters = Type.Object({});
  const memoryExport: AgentTool<typeof memoryExportParameters> = {
    name: "memory_export",
    label: "Export memory vault",
    description:
      "Save a portable JSON backup of your whole memory vault (every memory's frontmatter and body) to a file under your data directory, so you can move it to another machine or restore it later with memory_import.",
    parameters: memoryExportParameters,
    execute: async () => {
      const archive = await vault.exportArchive();
      const path = await writeArchiveFile(extendedOptions.home, archive);
      return {
        content: [
          {
            type: "text",
            text: `Exported ${archive.count} ${archive.count === 1 ? "memory" : "memories"} to ${path}.`,
          },
        ],
        details: { count: archive.count, path },
      };
    },
  };

  const memoryImportParameters = Type.Object({
    path: Type.String({
      description:
        "Path to a Wednesday vault export (.json). Must be inside your home or workspace.",
    }),
    mode: Type.Optional(
      Type.Union([Type.Literal("add"), Type.Literal("merge")]),
    ),
  });
  const memoryImport: AgentTool<typeof memoryImportParameters> = {
    name: "memory_import",
    label: "Import memory vault",
    description:
      "Restore memories from a vault export created by memory_export. By default existing memories with the same title are kept (skipped); pass mode 'merge' to overwrite them.",
    executionMode: "sequential",
    parameters: memoryImportParameters,
    execute: async (_id, params) => {
      const full = resolveImportPath(params.path);
      const archive = parseArchive(await readFile(full, "utf8"));
      const result = await vault.importArchive(archive, {
        mode: params.mode ?? "add",
      });
      // Rebuild the index from scratch so every restored memory is
      // searchable; a full rebuild is simpler and correct for a bulk
      // restore where many files have just changed at once.
      await index.rebuild(vault.root);
      await journal.append({
        type: "vault.imported",
        actor: "tool",
        payload: { ...result, path: full },
      });
      return {
        content: [
          {
            type: "text",
            text: `Imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`,
          },
        ],
        details: result,
      };
    },
  };

  const tools: AgentTool[] = [
    memorySearch,
    memoryRead,
    memoryRemember,
    memoryExport,
    memoryImport,
    ...createUtilityTools(),
    ...createExtendedTools(browser, workspace, extendedOptions),
    ...createComputerTools(sandbox, workspace),
  ];

  const memoryStats: AgentTool<typeof memorySearchParameters> = {
    name: "memory_stats",
    label: "Memory vault stats",
    description:
      "Summarize the memory vault: how many memories there are, how they break down by type and folder, roughly how much you've written, and the oldest and newest entries.",
    parameters: memorySearchParameters,
    execute: async () => {
      const stats = await vault.stats();
      return {
        content: [
          {
            type: "text",
            text:
              `Memories: ${stats.total} · ~${stats.totalWords.toLocaleString()} words\n` +
              `By type: ${formatCounts(stats.byType)}\n` +
              `By folder: ${formatCounts(stats.byFolder)}\n` +
              (stats.oldest
                ? `Oldest: ${stats.oldest.title} (${stats.oldest.ageDays}d)\n`
                : "") +
              (stats.newest
                ? `Newest: ${stats.newest.title} (${stats.newest.ageDays}d)`
                : ""),
          },
        ],
        details: stats,
      };
    },
  };

  const memoryTags: AgentTool<typeof memorySearchParameters> = {
    name: "memory_tags",
    label: "Memory tags",
    description:
      "List every tag used across the memory vault with how many memories use it, most-used first.",
    parameters: memorySearchParameters,
    execute: async () => {
      const tags = await vault.tags();
      const text = tags.length
        ? tags.map((tag) => `${tag.tag} (${tag.count})`).join("\n")
        : "No tags yet.";
      return {
        content: [{ type: "text", text }],
        details: { tags },
      };
    },
  };

  tools.push(memoryStats, memoryTags);

  if (sandbox.enabled) {
    const sandboxShellParameters = Type.Object({
      command: Type.String({ minLength: 1, maxLength: 4000 }),
      timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
    });
    tools.push({
      name: "sandbox_shell",
      label: "Sandbox shell",
      description:
        "Run a command in a sealed-off Docker container with no network access. Your workspace is mounted at /workspace.",
      executionMode: "sequential",
      parameters: sandboxShellParameters,
      execute: async (_id, params) => {
        const p = params as Static<typeof sandboxShellParameters>;
        const result = await sandbox.run(
          p.command,
          p.timeoutSeconds ?? 30,
        );
        await journal.append({
          type: "sandbox.completed",
          actor: "tool",
          payload: {
            command: p.command,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
          },
        });
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
      },
    });
  }

  return tools;
}
