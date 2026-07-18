import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface SandboxConfig {
  enabled: boolean;
  image: string;
  workspace: string;
  memoryMb: number;
  cpus: number;
}
export interface BrowserConfig {
  enabled: boolean;
  backend: "auto" | "cloak" | "scrapling" | "chromium";
  chromiumExecutable: string;
  pythonExecutable: string;
  respectRobots: boolean;
  allowPrivateHosts: boolean;
  timeoutSeconds: number;
}
export interface RateLimitConfig {
  windowMs: number;
  max: number;
}
export interface ServerSettings {
  host: string;
  port: number;
  rateLimit: RateLimitConfig;
}
export interface MemoryConfig {
  embeddingsEnabled: boolean;
  /** Embedding strategy for semantic recall. "hash" is the bundled,
   * dependency-free default; "onnx" is a documented extension point. */
  embedder?: "hash" | "onnx";
  staleDays: number;
}
export interface SchedulerTask {
  id: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
}
export interface SchedulerConfig {
  enabled: boolean;
  tasks: SchedulerTask[];
}
export interface GitConfig {
  remote: string | null;
}
export interface VoiceConfig {
  enabled: boolean;
  engine: "auto" | "say" | "espeak" | "spd-say" | "powershell";
  rate: number;
}
export interface IntegrationsConfig {
  calendar: { provider: "none" | "google" | "microsoft" };
  email: { provider: "none" | "gmail" | "outlook" };
}
export interface SessionConfig {
  summarizeAfterMessages: number;
  keepRecentMessages: number;
}
export interface OpenAICompatibleModel {
  /** Model id sent to the upstream API (e.g. "tencent/hy3"). */
  id: string;
  /** Human-readable display name. Defaults to `id` when omitted. */
  name?: string;
  reasoning: boolean;
  toolCall: boolean;
  vision: boolean;
  /** Largest input context the model accepts, in tokens. */
  contextWindow: number;
  /** Largest single-response output the model produces, in tokens. */
  maxTokens: number;
}
export interface AppAttribution {
  /** App URL sent as the `HTTP-Referer` header. OpenRouter requires this for
   *  any app attribution to take effect — without it, no app page is created
   *  and the request is not counted in rankings. Omit to disable attribution. */
  referer?: string;
  /** Display name sent as `X-OpenRouter-Title` (e.g. "Wednesday"). */
  title?: string;
  /** Comma-separated OpenRouter marketplace categories (e.g.
   *  "cli-agent,personal-agent"); capped at 2 per request by OpenRouter. */
  categories?: string;
}
export interface OpenAICompatibleProvider {
  /** Unique provider id referenced by `model.provider` (e.g. "novita-ai"). */
  id: string;
  /** Display name shown in the UI. Defaults to `id` when omitted. */
  name?: string;
  /** Base URL of the OpenAI-compatible `/v1` endpoint. */
  baseURL: string;
  /** API shape to use. Most third-party OpenAI-compatible gateways
   *  (Novita, SiliconFlow, Featherless, UnoRouter, Agnes, vLLM, etc.)
   *  only implement the Chat Completions API, so `"completions"` is the
   *  default. Use `"responses"` only for endpoints that implement the
   *  newer OpenAI Responses API (e.g. api.openai.com, OpenRouter). */
  api?: "responses" | "completions";
  /** API key sent as `Authorization: Bearer`. */
  apiKey: string;
  models: OpenAICompatibleModel[];
  /** Optional OpenRouter app-attribution headers attached to every request
   *  (HTTP-Referer / X-OpenRouter-Title / X-OpenRouter-Categories). Only
   *  meaningful for OpenRouter-fronted endpoints. */
  attribution?: AppAttribution;
}
export type ThinkingLevel =
  "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelTuning {
  provider: string;
  id: string;
  // Reasoning depth passed through to the model as its "thinking level".
  // Defaults to "high" so Wednesday always uses the deepest reasoning the
  // connected model supports (models that don't support reasoning ignore
  // this safely).
  thinkingLevel: ThinkingLevel;
  // Sampling temperature. null means "leave the provider's own default";
  // Wednesday defaults to a low, precision-favoring value since it is an
  // agentic/coding assistant, not a creative-writing one.
  temperature: number | null;
  // "auto" computes the largest safe output-token ceiling for the
  // connected model (see WednesdayModelManager.effectiveMaxTokens); a
  // number pins an explicit cap instead.
  maxOutputTokens: number | "auto";
}
export interface SettingsFile {
  version: 1;
  home: string;
  workspace: string;
  gitHistory: boolean;
  model: ModelTuning;
  /** OpenRouter app-attribution headers (HTTP-Referer / X-OpenRouter-Title /
   *  X-OpenRouter-Categories). Applied to the built-in `openrouter` provider
   *  and any OpenAI-compatible provider. Omit `referer` to disable. */
  attribution?: AppAttribution;
  browser: BrowserConfig;
  sandbox: Omit<SandboxConfig, "workspace">;
  server: ServerSettings;
  memory: MemoryConfig;
  scheduler: SchedulerConfig;
  git: GitConfig;
  voice: VoiceConfig;
  integrations: IntegrationsConfig;
  session: SessionConfig;
  openaiCompatible: OpenAICompatibleProvider[];
}
export interface WednesdayConfig extends SettingsFile {
  configPath: string;
  vault: string;
  index: string;
  journal: string;
  skills: string;
  sessionFile: string;
  sandbox: SandboxConfig;
}

function appConfigDir() {
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "Wednesday");
  if (platform() === "win32")
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "Wednesday",
    );
  return join(homedir(), ".config", "wednesday");
}
function appDataDir() {
  if (platform() === "darwin")
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Wednesday",
      "data",
    );
  if (platform() === "win32")
    return join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      "Wednesday",
    );
  return join(homedir(), ".local", "share", "wednesday");
}
export function configPath() {
  return join(appConfigDir(), "config.json");
}
export function pythonExecutable(home = appDataDir()) {
  return platform() === "win32"
    ? join(home, "python", "Scripts", "python.exe")
    : join(home, "python", "bin", "python");
}

export function defaultSettings(): SettingsFile {
  const home = appDataDir();
  return {
    version: 1,
    home,
    workspace: process.cwd(),
    gitHistory: true,
    model: {
      provider: "anthropic",
      id: "claude-sonnet-4-6",
      thinkingLevel: "high",
      temperature: 0.3,
      maxOutputTokens: "auto",
    },
    browser: {
      enabled: true,
      backend: "auto",
      chromiumExecutable: "chromium",
      pythonExecutable: pythonExecutable(home),
      respectRobots: true,
      allowPrivateHosts: false,
      timeoutSeconds: 45,
    },
    sandbox: {
      enabled: false,
      image: "node:24-bookworm-slim",
      memoryMb: 512,
      cpus: 1,
    },
    server: {
      host: "127.0.0.1",
      port: 4317,
      rateLimit: { windowMs: 60_000, max: 120 },
    },
    memory: { embeddingsEnabled: true, embedder: "hash", staleDays: 45 },
    scheduler: { enabled: false, tasks: [] },
    git: { remote: null },
    voice: { enabled: false, engine: "auto", rate: 1 },
    integrations: {
      calendar: { provider: "none" },
      email: { provider: "none" },
    },
    session: { summarizeAfterMessages: 60, keepRecentMessages: 24 },
    openaiCompatible: [],
    attribution: {
      referer: "https://github.com/BlusceLabs/Wednesday",
      title: "Wednesday",
      categories: "cli-agent,personal-agent",
    },
  };
}

function merge(base: SettingsFile, input: Partial<SettingsFile>): SettingsFile {
  return {
    ...base,
    ...input,
    model: { ...base.model, ...input.model },
    browser: { ...base.browser, ...input.browser },
    sandbox: { ...base.sandbox, ...input.sandbox },
    server: {
      ...base.server,
      ...input.server,
      rateLimit: { ...base.server.rateLimit, ...input.server?.rateLimit },
    },
    memory: { ...base.memory, ...input.memory },
    scheduler: {
      ...base.scheduler,
      ...input.scheduler,
      tasks: input.scheduler?.tasks ?? base.scheduler.tasks,
    },
    git: { ...base.git, ...input.git },
    voice: { ...base.voice, ...input.voice },
    integrations: {
      calendar: {
        ...base.integrations.calendar,
        ...input.integrations?.calendar,
      },
      email: { ...base.integrations.email, ...input.integrations?.email },
    },
    session: { ...base.session, ...input.session },
    openaiCompatible: input.openaiCompatible ?? base.openaiCompatible,
    attribution: { ...base.attribution, ...input.attribution },
    version: 1,
  };
}

export function initializeConfig(force = false) {
  const path = configPath();
  if (!existsSync(path) || force) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(defaultSettings(), null, 2) + "\n", {
      mode: 0o600,
    });
    try {
      chmodSync(path, 0o600);
    } catch {}
  }
  return path;
}

export function loadSettings(): SettingsFile {
  const path = configPath();
  if (!existsSync(path)) return defaultSettings();
  const parsed = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<SettingsFile>;
  return merge(defaultSettings(), parsed);
}

export function saveSettings(settings: SettingsFile) {
  const path = initializeConfig();
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    chmodSync(path, 0o600);
  } catch {}
  return path;
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

/**
 * Validates a settings object against basic sanity rules that the JSON
 * schema alone can't express (ranges, cross-field consistency). Used by
 * `wednesday config validate` and by `doctor` so misconfiguration surfaces
 * clearly instead of failing deep inside the agent runtime.
 */
export function validateSettings(settings: SettingsFile): ValidationResult {
  const issues: string[] = [];
  if (settings.server.port < 1 || settings.server.port > 65535)
    issues.push("server.port must be between 1 and 65535");
  if (settings.server.rateLimit.max < 1)
    issues.push("server.rateLimit.max must be at least 1");
  if (settings.server.rateLimit.windowMs < 1000)
    issues.push("server.rateLimit.windowMs must be at least 1000");
  if (settings.memory.staleDays < 1)
    issues.push("memory.staleDays must be at least 1");
  if (
    settings.memory.embedder &&
    !["hash", "onnx"].includes(settings.memory.embedder)
  )
    issues.push("memory.embedder must be 'hash' or 'onnx'");
  if (settings.session.keepRecentMessages < 1)
    issues.push("session.keepRecentMessages must be at least 1");
  if (
    settings.session.summarizeAfterMessages <=
    settings.session.keepRecentMessages
  )
    issues.push(
      "session.summarizeAfterMessages must be greater than session.keepRecentMessages",
    );
  if (settings.voice.rate <= 0 || settings.voice.rate > 3)
    issues.push("voice.rate must be between 0 (exclusive) and 3");
  const thinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max"];
  if (!thinkingLevels.includes(settings.model.thinkingLevel))
    issues.push(
      `model.thinkingLevel must be one of ${thinkingLevels.join(", ")}`,
    );
  if (
    settings.model.temperature !== null &&
    (settings.model.temperature < 0 || settings.model.temperature > 2)
  )
    issues.push("model.temperature must be between 0 and 2, or null");
  if (
    settings.model.maxOutputTokens !== "auto" &&
    (!Number.isFinite(settings.model.maxOutputTokens) ||
      settings.model.maxOutputTokens < 1)
  )
    issues.push('model.maxOutputTokens must be "auto" or a positive number');
  for (const task of settings.scheduler.tasks) {
    if (!task.id) issues.push("scheduler task is missing an id");
    if (!task.prompt)
      issues.push(`scheduler task '${task.id}' is missing a prompt`);
    if (task.intervalMinutes < 1)
      issues.push(
        `scheduler task '${task.id}' intervalMinutes must be at least 1`,
      );
  }
  if (
    settings.git.remote !== null &&
    !/^[a-zA-Z][\w+.-]*:\/\//.test(settings.git.remote)
  )
    issues.push("git.remote must be a full URL (e.g. https://… or git@…:…)");
  return { ok: issues.length === 0, issues };
}

export function loadConfig(): WednesdayConfig {
  const settings = loadSettings();
  const home = resolve(settings.home);
  const workspace = resolve(settings.workspace);
  return {
    ...settings,
    configPath: configPath(),
    home,
    workspace,
    vault: resolve(home, "vault"),
    index: resolve(home, "index", "wednesday.sqlite"),
    journal: resolve(home, "journal", "events.jsonl"),
    skills: resolve(home, "skills"),
    sessionFile: resolve(home, "sessions", "current.json"),
    sandbox: { ...settings.sandbox, workspace },
  };
}
