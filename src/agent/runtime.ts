import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels, type AssistantMessage, type Api, type Model } from "@earendil-works/pi-ai";
import type { BrowserUse } from "../browser/use";
import { parseArchive, writeArchiveFile } from "../memory/archive";
import { type WednesdayConfig, saveSettings } from "../core/config";
import { WEDNESDAY_IDENTITY } from "../core/identity";
import { EventJournal } from "../core/journal";
import { PermissionService } from "../core/permissions";
import { providerSecretName, type SecretStore } from "../core/secrets";
import type { GitHistory } from "../history/git";
import type { MemoryIndex } from "../memory/index";
import type { MarkdownVault } from "../memory/vault";
import type { WednesdayModelManager } from "../models/manager";
import { createSerialQueue } from "../core/queue";
import { resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import type { DockerSandbox } from "../sandbox/docker";
import { summarizeOlderMessages } from "../sessions/store";
import type { SessionStore } from "../sessions/store";
import { createTools } from "./tools";
import { createSkillTools } from "../skills/tools";
import { discoverSkills, formatSkillIndex, type Skill } from "../skills/loader";

// Human-readable group labels for the tool-category keys derived from each
// tool's name prefix. Surfaced in the dashboard "Tool groups" metric and
// the Tools-panel grouping so raw prefixes like `cloakbrowser` read as
// "Browser" and `sandbox` reads as "Sandbox".
const CATEGORY_LABELS: Record<string, string> = {
  memory: "Memory",
  workspace: "Workspace",
  git: "Git",
  computer: "Computer",
  sandbox: "Sandbox",
  browser: "Browser",
  cloakbrowser: "Browser",
  scrapling: "Browser",
  text: "Text",
  math: "Math",
  date: "Date",
  data: "Data",
  voice: "Voice",
  calendar: "Calendar",
  email: "Email",
};

const HELP = `Local commands:
/help — show commands
/remember Title :: Memory text — save a durable memory
/recall search terms — search the vault (keyword + optional semantic recall)
/stale [days] — list memories not touched recently, oldest first
/reindex — rebuild the memory index
/model — show the active model
/models [provider] [--verbose] — list available models (active one marked)
/effort [level] — show or set reasoning effort for the current model (model-specific)
/session — show persistent-session information
/clear — clear the current conversation
/history — show recent memory commits
/forget Title — delete a memory by title
/export — back up the whole memory vault to a file
/import <path> [--merge] — restore memories from a backup file
/stats — show vault size and breakdown
/tags — list tags used across memories`;

// The standard reasoning-effort ladder. Models may advertise a narrower
// or relabelled set via `thinkingLevelMap`; we use this only to order the
// list sensibly when a model has no explicit map.
const STANDARD_THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

type EffortLevel = (typeof STANDARD_THINKING_LEVELS)[number];

/**
 * The thinking levels the *current* model actually supports, delegated to
 * pi-ai's `getSupportedThinkingLevels` (reads the model's `thinkingLevelMap`,
 * the `xhigh`/`max` opt-in levels, and provider defaults). Returns [] for
 * models with no adjustable reasoning.
 */
function effortLevelsFor(model: Model<Api>): string[] {
  return getSupportedThinkingLevels(model);
}

// Render a `{ key: count }` map as `key 1, key 2` for notices.
function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length
    ? entries.map(([key, value]) => `${key} ${value}`).join(", ")
    : "none";
}

export class WednesdayRuntime {
  private readonly agent: Agent;
  private readonly toolCatalog: Array<{
    name: string;
    label: string;
    description: string;
    category: string;
    group: string;
  }>;

  // Cumulative token usage across the session, fed by each turn's
  // `turn_end` usage report. Surfaced in the status footer.
  private usage = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };

  // Input tokens of the most recent completed turn — the most accurate
  // gauge of how full the context window currently is.
  private lastTurnInput = 0;
  // Tokens consumed by the current turn only, reset on each submit so the
  // dashboard's "Tokens per turn" chart can record one point per turn
  // (cumulative this.usage is separate and used for the status footer).
  private lastTurnTokens = 0;
  // Discovered skills, cached for the lifetime of a turn so the per-turn
  // system-prompt rebuild doesn't re-walk the skills dir on every message.
  private skillCache: Skill[] | null = null;

  constructor(
    readonly events: WednesdayEventBusLike,
    private readonly models: WednesdayModelManager,
    private readonly vault: MarkdownVault,
    private readonly index: MemoryIndex,
    private readonly journal: EventJournal,
    private readonly sessions: SessionStore,
    private readonly history: GitHistory,
    browser: BrowserUse,
    sandbox: DockerSandbox,
    private readonly config: WednesdayConfig,
    initialMessages: AgentMessage[],
    permissions: PermissionService,
    private readonly secrets?: SecretStore,
  ) {
    const tools = createTools(
      index,
      vault,
      history,
      journal,
      browser,
      sandbox,
      config.workspace,
      {
        gitRemote: config.git.remote,
        voice: config.voice,
        integrations: config.integrations,
        home: config.home,
        modelCapabilities: models.capabilities(),
      },
    ).concat(createSkillTools(config.skills));
    this.toolCatalog = tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      category: tool.name.split("_")[0],
      group: CATEGORY_LABELS[tool.name.split("_")[0]] ?? tool.name.split("_")[0],
    }));
    this.agent = new Agent({
      initialState: {
        systemPrompt: WEDNESDAY_IDENTITY,
        model: models.model,
        // Maximize reasoning depth by default so Wednesday always uses the
        // deepest "thinking" level the connected model supports; models
        // without reasoning support ignore this safely.
        thinkingLevel: config.model.thinkingLevel,
        tools,
        messages: initialMessages,
      },
      streamFn: models.stream,
      beforeToolCall: ({ toolCall, args }) =>
        permissions.check(toolCall.name, args as Record<string, unknown>),
    });

    this.agent.subscribe(async (event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        this.events.emit({
          type: "assistant.delta",
          delta: event.assistantMessageEvent.delta,
        });
      } else if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "thinking_delta"
      ) {
        // Reasoning-model thinking (e.g. Novita's hy3 `reasoning_content`).
        // Forwarded separately so the UI can surface it distinctly from the
        // final answer.
        this.events.emit({
          type: "thinking.delta",
          delta: event.assistantMessageEvent.delta,
        });
      } else if (event.type === "turn_end") {
        // Accumulate per-turn token usage for the status footer.
        const u = (event.message as AssistantMessage).usage;
        if (u) {
          this.usage.input += u.input;
          this.usage.output += u.output;
          this.usage.reasoning += u.reasoning ?? 0;
          this.usage.cacheRead += u.cacheRead;
          this.usage.cacheWrite += u.cacheWrite;
          this.usage.total += u.totalTokens;
          // Full prompt size sent this turn = fresh + cached + written.
          this.lastTurnInput = u.input + u.cacheRead + u.cacheWrite;
          this.lastTurnTokens += u.totalTokens;
        }
      } else if (event.type === "tool_execution_start") {
        this.events.emit({ type: "tool.start", name: event.toolName });
      } else if (event.type === "tool_execution_end") {
        this.events.emit({
          type: "tool.end",
          name: event.toolName,
          isError: event.isError,
        });
      } else if (event.type === "agent_end") {
        await this.maybeSummarize();
        await this.sessions.save(this.agent.state.messages);
        this.events.emit({ type: "assistant.done" });
      }
    });
  }

  sessionInfo() {
    return this.sessions.info();
  }

  toolsInfo() {
    return { total: this.toolCatalog.length, tools: this.toolCatalog };
  }

  /**
   * Snapshot for the status footer: cumulative token usage, cache-hit
   * rate, estimated live-context usage, and model metadata.
   */
  stats() {
    const caps = this.models.capabilities();
    const u = this.usage;
    const contextWindow = caps.contextWindow ?? 0;
    const contextTokens = this.lastTurnInput;
    const promptTokens =
      this.usage.cacheRead + this.usage.input + this.usage.cacheWrite;
    return {
      usage: u,
      cacheHitPct: promptTokens > 0 ? (this.usage.cacheRead / promptTokens) * 100 : 0,
      contextTokens,
      contextWindow,
      contextPct: contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0,
      maxOutput: caps.maxOutputTokens,
      maxOutputAuto: this.config.model.maxOutputTokens === "auto",
      modelId: this.config.model.id,
      thinkingLevel: this.config.model.thinkingLevel,
      workspace: this.config.workspace,
    };
  }

  journalTail(limit = 50) {
    return this.journal.tail(limit);
  }

  /**
   * Installed agentskills.io skills (SKILL.md files under the skills dir),
   * re-discovered live so a skill added mid-session shows up on refresh.
   */
  skills() {
    return discoverSkills(this.config.skills);
  }

  /**
   * Skills for the current turn, discovered once and cached. Skill content
   * is folded into the system prompt so Wednesday can follow any installed
   * skill by reading its SKILL.md via the read-only skill_read tool.
   */
  private async resolveSkills(): Promise<Skill[]> {
    if (this.skillCache) return this.skillCache;
    this.skillCache = await discoverSkills(this.config.skills);
    return this.skillCache;
  }

  /**
   * Token usage and model for the most recent turn, consumed by the
   * dashboard's live usage charts via the streamed `done` event. `tokens`
   * is the per-turn total (0 for command-only turns with no model usage).
   */
  lastTurnUsage() {
    return { tokens: this.lastTurnTokens, model: this.config.model.id };
  }

  /** Vault analytics for the dashboard's Memory view. */
  vaultStats() {
    return this.vault.stats();
  }
  vaultTags() {
    return this.vault.tags();
  }

  /**
   * Back up the whole memory vault to a portable file. Extracted from the
   * `/export` command so the dashboard's Memory view can call the same
   * logic over HTTP and surface the result directly.
   */
  async exportVault(): Promise<{ count: number; path: string }> {
    const archive = await this.vault.exportArchive();
    const path = await writeArchiveFile(this.config.home, archive);
    await this.journal.append({
      type: "vault.exported",
      actor: "user",
      payload: { count: archive.count, path },
    });
    return { count: archive.count, path };
  }

  /**
   * Restore memories from a vault export. Extracted from the `/import`
   * command so the dashboard's Memory view can drive it over HTTP. The
   * path is confined to the user's home/workspace before anything is read.
   */
  async importVault(
    raw: string,
    merge: boolean,
  ): Promise<{
    imported: number;
    updated: number;
    skipped: number;
    path: string;
  }> {
    const full = resolve(raw);
    const home = this.config.home;
    const workspace = this.config.workspace;
    const inside =
      full === home ||
      full.startsWith(home + sep) ||
      full === workspace ||
      full.startsWith(workspace + sep);
    if (!inside)
      throw new Error("Import path must be inside your home or workspace");
    const archive = parseArchive(await readFile(full, "utf8"));
    const result = await this.vault.importArchive(archive, {
      mode: merge ? "merge" : "add",
    });
    await this.index.rebuild(this.vault.root);
    await this.journal.append({
      type: "vault.imported",
      actor: "user",
      payload: { ...result, path: full },
    });
    return { ...result, path: full };
  }

  /**
   * Flat list of every model across every known provider, for the `/models`
   * popup selector. Each entry exposes the full pi-ai `Model` metadata plus
   * the model-specific thinking levels (via `getSupportedThinkingLevels`)
   * and the cost rates — everything the picker needs to render a rich,
   * authoritative view without re-reading pi-ai's catalog.
   */
  listModels(): Array<{
    provider: string;
    id: string;
    name: string;
    api: string;
    baseUrl: string;
    active: boolean;
    reasoning: boolean;
    vision: boolean;
    input: string[];
    contextWindow: number;
    maxTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    thinkingLevels: string[];
  }> {
    const active = this.models.label;
    const out: Array<{
      provider: string;
      id: string;
      name: string;
      api: string;
      baseUrl: string;
      active: boolean;
      reasoning: boolean;
      vision: boolean;
      input: string[];
      contextWindow: number;
      maxTokens: number;
      cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
      thinkingLevels: string[];
    }> = [];
    for (const provider of this.models.models.getProviders()) {
      const entries = [...this.models.models.getModels(provider.id)].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      for (const model of entries) {
        const label = `${provider.id}/${model.id}`;
        out.push({
          provider: provider.id,
          id: model.id,
          name: model.name && model.name !== model.id ? model.name : model.id,
          api: String(model.api),
          baseUrl: model.baseUrl,
          active: label === active,
          reasoning: Boolean(model.reasoning),
          vision: model.input.includes("image"),
          input: model.input,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          cost: {
            input: model.cost.input ?? 0,
            output: model.cost.output ?? 0,
            cacheRead: model.cost.cacheRead ?? 0,
            cacheWrite: model.cost.cacheWrite ?? 0,
          },
          // Authoritative per-model thinking levels straight from pi-ai.
          thinkingLevels: getSupportedThinkingLevels(model),
        });
      }
    }
    return out;
  }

  /**
   * Switch the active model (used by the `/models` popup selector) and
   * persist the choice. Keeps the live agent pointed at the new model so
   * subsequent turns stream from it without a restart. Notifies the UI via
   * a `model.changed` event; returns the new label.
   */
  setModel(provider: string, id: string) {
    const label = this.models.setModel(provider, id);
    this.agent.state.model = this.models.model;
    saveSettings(this.config);
    this.events.emit({ type: "model.changed", provider, id });
    // Record the switch in the hash-chained journal so it surfaces in the
    // dashboard's audit log alongside other durable, user-initiated actions.
    this.journal.append({
      type: "model.changed",
      actor: "user",
      payload: { provider, id, label },
    });
    return label;
  }

  /**
   * Set the reasoning-effort level for the active model (mirrors the TUI's
   * `/effort` command) and persist it. Validates against the levels the
   * current model actually supports; throws on an unsupported level. Records
   * the change in the hash-chained journal so it appears in the audit log.
   */
  setThinkingLevel(level: string) {
    const levels = effortLevelsFor(this.models.model);
    if (levels.length === 0)
      throw new Error(
        `Model ${this.models.label} does not support adjustable reasoning effort.`,
      );
    const next = level.toLowerCase() as EffortLevel;
    if (!levels.includes(next))
      throw new Error(
        `Unsupported effort "${next}" for ${this.models.label}. Available: ${levels.join(", ")}.,`
      );
    this.config.model.thinkingLevel = next;
    this.agent.state.thinkingLevel = next;
    saveSettings(this.config);
    this.journal.append({
      type: "effort.changed",
      actor: "user",
      payload: { level: next, model: this.models.label },
    });
    return next;
  }

  /** Per-provider auth readiness from pi-ai's `checkAuth` (UI picker). */
  authInfoFor(provider: string) {
    return this.models.authInfo(provider);
  }

  /** Set of `provider/id` labels whose provider is fully configured. */
  async availableModelIds() {
    return this.models.availableModels();
  }

  /**
   * Persist an API key for a provider (entered from the `/models` picker
   * when a provider shows "(no key)"), then refresh pi-ai's auth so the
   * catalog for that provider becomes usable. Mirrors opencode's "add a key
   * inline" flow: you're prompted, the key is stored in the OS keychain, and
   * the chosen model can then be selected immediately.
   */
  async setProviderKey(provider: string, key: string) {
    if (!this.secrets) throw new Error("No secret store available");
    await this.secrets.set(providerSecretName(provider), key);
    this.models.setApiKey(provider, key);
    return this.models.availableModels();
  }

  /**
   * Cross-session memory summarization. Once the live message array grows
   * past config.session.summarizeAfterMessages, condense everything older
   * than config.session.keepRecentMessages messages into a durable vault
   * memory (so nothing is silently lost) and drop it from the live
   * conversation, keeping future requests smaller and more focused.
   */
  private async maybeSummarize() {
    if (
      this.agent.state.messages.length <
      this.config.session.summarizeAfterMessages
    )
      return;
    const { summary, trimmed, droppedCount } = summarizeOlderMessages(
      this.agent.state.messages,
      this.config.session.keepRecentMessages,
    );
    if (droppedCount === 0) return;
    // Prefer a model-generated summary over raw excerpt concatenation;
    // fall back to the excerpt if the model call fails or is too short.
    const condensed = (await this.models.summarize(summary)) || summary;
    const memory = await this.vault.remember({
      title: `Conversation summary ${new Date().toISOString()}`,
      body: condensed,
      type: "knowledge",
      tags: ["conversation-summary"],
      sourceRef: "auto-summary",
    });
    // Incremental sync (only the new summary file gets embedded) instead
    // of a full rebuild of the whole vault on every summarization.
    await this.index.sync(this.vault.root);
    await this.history.commit(memory.path, "Auto-summarize older conversation");
    this.agent.state.messages = trimmed;
    await this.journal.append({
      type: "session.summarized",
      actor: "system",
      payload: { droppedCount },
    });
  }

  // Single-flight queue so every caller (TUI, headless, the HTTP API, and
  // the proactive scheduler) drives the underlying agent one turn at a
  // time. Without it, concurrent submit()s interleave on the shared
  // `agent.state.messages` array and corrupt the conversation / session
  // save / auto-summarize steps. The queue implementation lives in
  // core/queue.ts so it can be unit-tested in isolation.
  private readonly queue = createSerialQueue();

  async submit(text: string) {
    return this.queue.run(() => this.submitRaw(text));
  }

  private async submitRaw(text: string) {
    this.lastTurnTokens = 0;
    if (!text.startsWith("/")) return this.prompt(text);
    this.events.emit({ type: "status", value: "thinking" });
    try {
      await this.runCommand(text);
      this.events.emit({ type: "assistant.done" });
      this.events.emit({ type: "status", value: "ready" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.emit({ type: "error", message });
      this.events.emit({ type: "status", value: "error" });
    }
  }

  private async runCommand(input: string) {
    const [command, ...parts] = input.trim().split(/\s+/);
    const rest = parts.join(" ").trim();
    if (command === "/help") return this.notice(HELP);
    if (command === "/model") {
      const caps = this.models.capabilities();
      const m = this.models.model;
      const levels = this.models.supportedThinkingLevels();
      const cost = m.cost;
      const auth = await this.models.authInfo(m.provider);
      const tierLine = cost.tiers?.length
        ? `  tiers: ${cost.tiers
            .map((t) => `$${t.input}/$${(t.output)}/$${(t.cacheRead)}/$${(t.cacheWrite)} above ${t.inputTokensAbove}`)
            .join(", ")}`
        : "";
      return this.notice(
        [
          `Active model: ${this.models.label}`,
          `Name: ${m.name}`,
          `API: ${m.api}${m.baseUrl ? `  (${m.baseUrl})` : ""}`,
          `Context window: ${caps.contextWindow?.toLocaleString() ?? "unknown"} tokens`,
          `Max output tokens (this session): ${caps.maxOutputTokens.toLocaleString()}`,
          `Input modalities: ${m.input.join(", ")}`,
          `Vision (image input): ${caps.vision ? "yes" : "no"}`,
          `Tool calling: yes`,
          `Reasoning/thinking: ${
            caps.reasoning
              ? `yes (level: ${this.config.model.thinkingLevel})`
              : "no"
          }`,
          `Supported thinking levels: ${levels.length ? levels.join(", ") : "none"}`,
          `Temperature: ${this.config.model.temperature ?? "provider default"}`,
          `Cost $/M: in $${(cost.input ?? 0).toFixed(2)} · out $${(cost.output ?? 0).toFixed(2)} · cacheR $${(cost.cacheRead ?? 0).toFixed(2)} · cacheW $${(cost.cacheWrite ?? 0).toFixed(2)}`,
          tierLine,
          `Auth: ${
            auth
              ? `configured via ${auth.source ?? auth.type} (${auth.type})`
              : "not configured — add a key to use this provider"
          }`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    if (command === "/effort") {
      const model = this.models.model;
      const levels = effortLevelsFor(model);
      const current = this.config.model.thinkingLevel;
      if (levels.length === 0) {
        return this.notice(
          `Model ${this.models.label} does not support adjustable reasoning effort.`,
        );
      }
      if (!rest) {
        const list = levels
          .map(
            (lvl) =>
              `  ${lvl === current ? "●" : " "} ${lvl}${lvl === current ? "  (current)" : ""}`,
          )
          .join("\n");
        return this.notice(
          [
            `Reasoning effort for ${this.models.label}:`,
            list,
            "",
            "Set: /effort <level>   e.g. /effort medium",
          ].join("\n"),
        );
      }
      const next = rest.toLowerCase() as EffortLevel;
      if (!levels.includes(next)) {
        throw new Error(
          `Unsupported effort "${next}" for ${this.models.label}. Available: ${levels.join(", ")}.`,
        );
      }
      this.config.model.thinkingLevel = next;
      this.agent.state.thinkingLevel = next;
      saveSettings(this.config);
      return this.notice(
        `Reasoning effort set to "${next}". Applies on the next turn — no restart needed.`,
      );
    }
    if (command === "/models") {
      const verbose = parts.includes("--verbose") || parts.includes("-v");
      const filter = rest
        .replace(/--verbose|--v/g, "")
        .trim()
        .toLowerCase();
      const active = this.models.label;
      const providers = this.models.models
        .getProviders()
        .map((provider) => provider.id)
        .filter((id) => !filter || id.toLowerCase() === filter)
        .sort();
      if (providers.length === 0) {
        throw new Error(
          filter
            ? `No provider matches "${filter}". Use /models to see all.`
            : "No providers available.",
        );
      }
      // pi-ai's getAvailable() tells us which models are usable right now
      // (provider fully configured) vs the full pi-ai catalog.
      const available = await this.models.availableModels();
      const lines: string[] = [];
      for (const provider of providers) {
        const entries = [...this.models.models.getModels(provider)];
        if (entries.length === 0) continue;
        lines.push(`${provider} (${entries.length})`);
        for (const model of entries.sort((a, b) => a.id.localeCompare(b.id))) {
          const label = `${provider}/${model.id}`;
          const marker = label === active ? "●" : " ";
          const ready = available.has(label) ? "" : " (no key)";
          const caps: string[] = [];
          if (model.reasoning) caps.push("reasoning");
          if (model.input.includes("image")) caps.push("vision");
          caps.push("tools");
          let line = `  ${marker} ${model.id}${ready}`;
          if (model.name && model.name !== model.id)
            line += ` — ${model.name}`;
          line += `  [${caps.join(", ")}]`;
          if (verbose) {
            const cost = model.cost;
            const levels = getSupportedThinkingLevels(model);
            line += `\n      ctx ${model.contextWindow.toLocaleString()} tok · out ${model.maxTokens.toLocaleString()} tok · api ${model.api}`;
            line += `\n      $ ${(cost.input ?? 0).toFixed(2)}/M in · $ ${(cost.output ?? 0).toFixed(2)}/M out · cacheR $ ${(cost.cacheRead ?? 0).toFixed(2)} · cacheW $ ${(cost.cacheWrite ?? 0).toFixed(2)}`;
            line += `\n      thinking: ${levels.length ? levels.join(", ") : "none"}${model.baseUrl ? ` · ${model.baseUrl}` : ""}`;
          }
          lines.push(line);
        }
        lines.push("");
      }
      lines.push(
        `Active model: ${active}  (use /model to see its full capabilities)`,
      );
      lines.push(
        `● = active · (no key) = provider not configured yet · /models --verbose for cost, API & thinking levels`,
      );
      return this.notice(lines.join("\n").trimEnd());
    }
    if (command === "/session") {
      const info = await this.sessions.info();
      return this.notice(
        `Session: ${info.messages} messages\nUpdated: ${info.updatedAt ?? "not saved yet"}\n${info.path}`,
      );
    }
    if (command === "/clear") {
      this.agent.state.messages = [];
      await this.sessions.clear();
      await this.journal.append({
        type: "session.cleared",
        actor: "user",
        payload: {},
      });
      return this.notice(
        "Conversation cleared. Durable memories were not deleted.",
      );
    }
    if (command === "/history") {
      const entries = await this.history.log();
      return this.notice(
        entries.length
          ? entries.map((entry) => `• ${entry}`).join("\n")
          : "No memory commits yet.",
      );
    }
    if (command === "/reindex") {
      await this.index.rebuild(this.vault.root);
      await this.journal.append({
        type: "memory.reindexed",
        actor: "system",
        payload: {},
      });
      return this.notice("Memory index rebuilt.");
    }
    if (command === "/stale") {
      const days = rest ? Number(rest) : this.config.memory.staleDays;
      const items = this.index.stale(
        Number.isFinite(days) && days > 0 ? days : this.config.memory.staleDays,
      );
      return this.notice(
        items.length
          ? items
              .map(
                (item) =>
                  `• ${item.title} — ${item.ageDays}d old [${item.path}]`,
              )
              .join("\n")
          : "No stale memories found.",
      );
    }
    if (command === "/forget") {
      if (!rest) throw new Error("Usage: /forget <memory title>");
      const removed = await this.vault.forget(rest);
      return this.notice(
        removed
          ? `Forgot “${rest}”.`
          : `No memory titled “${rest}” was found.`,
      );
    }
    if (command === "/tags") {
      const tags = await this.vault.tags();
      return this.notice(
        tags.length
          ? tags.map((tag) => `• ${tag.tag} — ${tag.count}`).join("\n")
          : "No tags yet.",
      );
    }
    if (command === "/stats") {
      const stats = await this.vault.stats();
      const lines = [
        `Memories: ${stats.total} (~${stats.totalWords.toLocaleString()} words)`,
        `By type: ${formatCounts(stats.byType)}`,
        `By folder: ${formatCounts(stats.byFolder)}`,
      ];
      if (stats.oldest)
        lines.push(`Oldest: ${stats.oldest.title} (${stats.oldest.ageDays}d old)`);
      if (stats.newest)
        lines.push(`Newest: ${stats.newest.title} (${stats.newest.ageDays}d old)`);
      return this.notice(lines.join("\n"));
    }
    if (command === "/export") {
      const archive = await this.vault.exportArchive();
      const path = await writeArchiveFile(this.config.home, archive);
      await this.journal.append({
        type: "vault.exported",
        actor: "user",
        payload: { count: archive.count, path },
      });
      return this.notice(
        `Exported ${archive.count} ${archive.count === 1 ? "memory" : "memories"} to ${path}.`,
      );
    }
    if (command === "/import") {
      if (!rest) throw new Error("Usage: /import <path> [--merge]");
      const merge = rest.includes("--merge");
      const raw = rest.replace("--merge", "").trim();
      const full = resolve(raw);
      const home = this.config.home;
      const workspace = this.config.workspace;
      const inside =
        full === home ||
        full.startsWith(home + sep) ||
        full === workspace ||
        full.startsWith(workspace + sep);
      if (!inside)
        throw new Error("Import path must be inside your home or workspace");
      const archive = parseArchive(await readFile(full, "utf8"));
      const result = await this.vault.importArchive(archive, {
        mode: merge ? "merge" : "add",
      });
      await this.index.rebuild(this.vault.root);
      await this.journal.append({
        type: "vault.imported",
        actor: "user",
        payload: { ...result, path: full },
      });
      return this.notice(
        `Imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`,
      );
    }
    if (command === "/recall") {
      if (!rest) throw new Error("Usage: /recall search terms");
      const hits = this.index.search(rest, 8);
      return this.notice(
        hits.length
          ? hits
              .map((hit) => `• ${hit.title} — ${hit.snippet} [${hit.path}]`)
              .join("\n")
          : "No matching memories.",
      );
    }
    if (command === "/remember") {
      const separator = rest.indexOf("::");
      if (separator < 1)
        throw new Error("Usage: /remember Title :: Memory text");
      const title = rest.slice(0, separator).trim();
      const body = rest.slice(separator + 2).trim();
      if (!title || !body)
        throw new Error("Both a title and memory text are required.");
      const memory = await this.vault.remember({
        title,
        body,
        sourceRef: "terminal",
      });
      // Incremental sync (only the new memory file gets embedded) instead
      // of a full rebuild of the whole vault on every /remember.
      await this.index.sync(this.vault.root);
      await this.history.commit(memory.path, `Remember: ${title}`);
      await this.journal.append({
        type: "memory.committed",
        actor: "user",
        payload: memory,
      });
      return this.notice(`Remembered “${title}”.`);
    }
    throw new Error(`Unknown command: ${command}. Use /help.`);
  }

  private notice(message: string) {
    this.events.emit({ type: "notice", message });
  }

  async prompt(text: string) {
    this.events.emit({ type: "status", value: "thinking" });
    const memories = this.index.search(text);
    const memoryContext = memories.length
      ? `\n\nRelevant user-controlled memories:\n${memories.map((hit) => `- [${hit.title}] ${hit.snippet} (vault:${hit.path})`).join("\n")}`
      : "";
    const skills = await this.resolveSkills();
    const skillContext = formatSkillIndex(skills);
    this.agent.state.systemPrompt = WEDNESDAY_IDENTITY + memoryContext + skillContext;
    // Fire the audit write without blocking the model's first token. The
    // EventJournal serializes appends internally, so this stays correctly
    // ordered with the run.* events that follow (and with any tool-event
    // appends that happen during the turn) even though it runs concurrently
    // with the model's network round-trip.
    const accepted = this.journal.append({
      type: "prompt.accepted",
      actor: "user",
      payload: { text, memories: memories.map((hit) => hit.path) },
    });
    try {
      await this.agent.prompt(text);
      // The agent loop swallows upstream API errors (e.g. auth failures)
      // and records them as a terminal message with stopReason "error"
      // rather than throwing, so `prompt()` resolves normally. Surface the
      // swallowed error here so the UI shows why nothing came back instead
      // of silently returning to a "ready" state with no response.
      const errorMessage = this.agent.state.errorMessage;
      if (errorMessage) {
        await this.journal.append({
          type: "run.failed",
          actor: "system",
          payload: { message: errorMessage },
        });
        this.events.emit({ type: "error", message: errorMessage });
        this.events.emit({ type: "status", value: "error" });
        return;
      }
      await this.journal.append({
        type: "run.completed",
        actor: "wednesday",
        payload: {},
      });
      this.events.emit({ type: "status", value: "ready" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.journal.append({
        type: "run.failed",
        actor: "system",
        payload: { message },
      });
      this.events.emit({ type: "error", message });
      this.events.emit({ type: "status", value: "error" });
    } finally {
      // Best-effort: ensure the prompt.accepted entry has flushed. It has
      // almost certainly finished during the (far longer) model call.
      await accepted.catch(() => {});
    }
  }

  abort() {
    this.agent.abort();
  }
}

type WednesdayEventBusLike = {
  emit: (event: import("../core/events").WednesdayEvent) => void;
  subscribe: (
    listener: (event: import("../core/events").WednesdayEvent) => void,
  ) => () => void;
};
