import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Static, Type } from "@earendil-works/pi-ai";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { resolveInside } from "./paths";
import type { BrowserUse } from "../browser/use";
import type { IntegrationsConfig, VoiceConfig } from "../core/config";
import { listEvents } from "../integrations/calendar";
import { listMessages } from "../integrations/email";
import { speak } from "../voice/speak";

const exec = promisify(execFile);
const schema = Type.Object({
  path: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  selector: Type.Optional(Type.String()),
});
type SchemaParams = Static<typeof schema>;
const voiceSpeakSchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 2000 }),
});
const textResult = (text: string, details: object = {}) => ({
  content: [{ type: "text" as const, text }],
  details,
});

export interface ExtendedToolOptions {
  gitRemote: string | null;
  voice: VoiceConfig;
  integrations: IntegrationsConfig;
  // Absolute path to Wednesday's data directory; used by memory_export to
  // write portable vault backups under `<home>/backups`.
  home: string;
  // Capabilities of the currently connected model (see
  // WednesdayModelManager.capabilities). Used to conditionally maximize
  // feature use, e.g. attaching real image content to vision-capable
  // models instead of a text-only description.
  modelCapabilities?: { vision: boolean };
}

export function createExtendedTools(
  browser: BrowserUse,
  workspaceRoot: string,
  options: ExtendedToolOptions,
): AgentTool[] {
  const root = resolve(workspaceRoot);
  const inside = (path = ".") => resolveInside(root, path);
  const walk = async (dir: string, limit = 500) => {
    const output: string[] = [];
    const visit = async (current: string) => {
      if (output.length >= limit) return;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if ([".git", "node_modules", ".wednesday"].includes(entry.name))
          continue;
        const full = resolve(current, entry.name);
        output.push(relative(root, full) + (entry.isDirectory() ? "/" : ""));
        if (entry.isDirectory()) await visit(full);
      }
    };
    await visit(dir);
    return output;
  };
  const workspace: Array<
    [string, string, (p: SchemaParams) => Promise<unknown>]
  > = [
    [
      "workspace_list",
      "Show what's inside a folder",
      async (p) =>
        (await readdir(inside(p.path), { withFileTypes: true })).map(
          (x) => x.name + (x.isDirectory() ? "/" : ""),
        ),
    ],
    [
      "workspace_read",
      "Read a file from your workspace",
      async (p) => (await readFile(inside(p.path), "utf8")).slice(0, 50_000),
    ],
    [
      "workspace_stat",
      "Show a file's size and last-changed time",
      async (p) => {
        const s = await stat(inside(p.path));
        return {
          size: s.size,
          modified: s.mtime.toISOString(),
          file: s.isFile(),
          directory: s.isDirectory(),
        };
      },
    ],
    [
      "workspace_tree",
      "Map out a folder and everything beneath it",
      async (p) => walk(inside(p.path)),
    ],
    [
      "workspace_search",
      "Find files that contain some text",
      async (p) => {
        const hits: string[] = [];
        for (const file of (await walk(root, 1000)).filter(
          (x) => !x.endsWith("/"),
        )) {
          try {
            if ((await readFile(inside(file), "utf8")).includes(p.query ?? ""))
              hits.push(file);
          } catch {}
          if (hits.length >= 100) break;
        }
        return hits;
      },
    ],
    [
      "workspace_hash",
      "Get a file's SHA-256 fingerprint",
      async (p) =>
        createHash("sha256")
          .update(await readFile(inside(p.path)))
          .digest("hex"),
    ],
    [
      "workspace_size",
      "Measure how big a file or folder is",
      async (p) => {
        const target = inside(p.path),
          s = await stat(target);
        if (s.isFile()) return s.size;
        let total = 0;
        for (const file of (await walk(target)).filter((x) => !x.endsWith("/")))
          try {
            total += (await stat(inside(file))).size;
          } catch {}
        return total;
      },
    ],
    [
      "workspace_exists",
      "Check whether a path exists",
      async (p) =>
        stat(inside(p.path)).then(
          () => true,
          () => false,
        ),
    ],
  ];
  const git: Array<
    [string, string, (p: SchemaParams) => string[]]
  > = [
    ["git_status", "See what's changed but not yet saved", () => ["status", "--short"]],
    ["git_diff", "Review the uncommitted changes", () => ["diff", "--"]],
    ["git_log", "Look back at the recent commit history", () => ["log", "-20", "--oneline"]],
    [
      "git_show",
      "Inspect a commit, branch, or file",
      (p) => ["show", "--stat", p.ref ?? "HEAD"],
    ],
    ["git_branch", "List the branches you have", () => ["branch", "--all"]],
    ["git_remote", "Show where your repo syncs to", () => ["remote", "-v"]],
    ["git_ls_files", "List the files Git is tracking", () => ["ls-files"]],
    ["git_blame", "See who wrote each line", (p) => ["blame", "--", p.path ?? ""]],
  ];
  const tools: AgentTool[] = workspace.map(([name, description, run]) => ({
    name,
    label: name.replaceAll("_", " "),
    description,
    parameters: schema,
    execute: async (_id, params) =>
      textResult(JSON.stringify(await run(params as SchemaParams), null, 2)),
  }));
  tools.push(
    ...git.map(([name, description, args]) => ({
      name,
      label: name.replaceAll("_", " "),
      description,
      parameters: schema,
      execute: async (_id: string, params: unknown) => {
        const { stdout, stderr } = await exec(
          "git",
          ["-C", root, ...args(params as SchemaParams)],
          { timeout: 20_000, maxBuffer: 1_000_000 },
        );
        return textResult((stdout + stderr).slice(0, 50_000));
      },
    })),
  );
  const network = (
    name: string,
    label: string,
    description: string,
    backend: "auto" | "cloak" | "scrapling",
  ) => ({
    name,
    label,
    description,
    parameters: schema,
    executionMode: "sequential" as const,
    execute: async (_id: string, params: unknown) => {
      const p = params as SchemaParams;
      return textResult(
        await browser.open(p.url ?? "", backend, p.selector),
        { url: p.url, backend },
      );
    },
  });
  tools.push(
    network(
      "browser_use",
      "Open a web page",
      "Visit a URL and read what's there.",
      "auto",
    ),
  );
  tools.push(
    network(
      "cloakbrowser_use",
      "Open a page quietly",
      "Visit a URL using a stealthier browser that's less likely to be flagged as a bot.",
      "cloak",
    ),
  );
  tools.push(
    network(
      "scrapling_extract",
      "Pull content from a page",
      "Fetch a URL and pull out its content, optionally just a specific part via a CSS selector.",
      "scrapling",
    ),
  );

  tools.push({
    name: "git_push",
    label: "git push",
    description:
      "Send your saved changes to the Git remote you've set up, so they follow you to other machines.",
    executionMode: "sequential",
    parameters: schema,
    execute: async () => {
      if (!options.gitRemote)
        throw new Error(
          "No git remote is configured. Set one with `bun run config -- set git.remote <url>`.",
        );
      const { stdout, stderr } = await exec(
        "git",
        ["-C", root, "push", options.gitRemote, "HEAD"],
        { timeout: 60_000, maxBuffer: 1_000_000 },
      );
      return textResult((stdout + stderr).slice(0, 50_000));
    },
  });
  tools.push({
    name: "git_pull",
    label: "git pull",
    description:
      "Bring in the latest changes from your Git remote, so your notes stay in sync across machines.",
    executionMode: "sequential",
    parameters: schema,
    execute: async () => {
      if (!options.gitRemote)
        throw new Error(
          "No git remote is configured. Set one with `bun run config -- set git.remote <url>`.",
        );
      const { stdout, stderr } = await exec(
        "git",
        ["-C", root, "pull", options.gitRemote, "HEAD"],
        { timeout: 60_000, maxBuffer: 1_000_000 },
      );
      return textResult((stdout + stderr).slice(0, 50_000));
    },
  });
  const visionCapable = options.modelCapabilities?.vision ?? false;
  tools.push({
    name: "browser_screenshot",
    label: "Browser screenshot",
    description: visionCapable
      ? "Take a full-page screenshot with headless Chromium and show it to me so I can see and describe it."
      : "Take a full-page screenshot with headless Chromium and save it to your workspace for you to look at. (I can't actually see images on this model, so you'll need to review it.)",
    executionMode: "sequential",
    parameters: schema,
    execute: async (_id, params: unknown) => {
      const p = params as SchemaParams;
      if (!p.url) throw new Error("A url is required.");
      // Route through the shared browser guard so screenshots honor the
      // same private-host (allowPrivateHosts) and robots.txt policy as the
      // other browser tools, instead of bypassing it.
      const safeUrl = await browser.validate(p.url);
      const fileName = `screenshot-${Date.now()}.png`;
      const target = resolve(root, ".wednesday", "screenshots", fileName);
      await mkdir(dirname(target), { recursive: true });
      await exec(
        browser.chromiumExecutable,
        [
          "--headless=new",
          "--disable-gpu",
          "--window-size=1280,900",
          `--screenshot=${target}`,
          safeUrl,
        ],
        { timeout: 45_000 },
      );
      const relativePath = relative(root, target);
      if (!visionCapable) {
        return textResult(`Saved screenshot to ${relativePath}.`, {
          path: relativePath,
        });
      }
      const png = await readFile(target);
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved screenshot to ${relativePath}.`,
          },
          {
            type: "image" as const,
            data: png.toString("base64"),
            mimeType: "image/png",
          },
        ],
        details: { path: relativePath },
      };
    },
  });
  tools.push({
    name: "calendar_list_events",
    label: "Calendar events",
    description:
      "Show what's coming up on your calendar, if you've connected one. I'll let you know if it isn't set up yet.",
    executionMode: "sequential",
    parameters: schema,
    execute: async () =>
      textResult(
        JSON.stringify(
          await listEvents(options.integrations.calendar),
          null,
          2,
        ),
      ),
  });
  tools.push({
    name: "email_list_messages",
    label: "Email messages",
    description:
      "Show your recent messages, if you've connected an email account. I'll let you know if it isn't set up yet.",
    executionMode: "sequential",
    parameters: schema,
    execute: async () =>
      textResult(
        JSON.stringify(await listMessages(options.integrations.email), null, 2),
      ),
  });
  tools.push({
    name: "voice_speak",
    label: "Say it out loud",
    description:
      "Read some text aloud using your system's text-to-speech voice.",
    executionMode: "sequential",
    parameters: voiceSpeakSchema,
    execute: async (_id, params: unknown) => {
      const p = params as Static<typeof voiceSpeakSchema>;
      const result = await speak(p.text, options.voice);
      return textResult(
        `Spoke ${p.text.length} character(s) via ${result.engine}.`,
      );
    },
  });

  return tools;
}
export const extendedToolCount = 25;
