import type {
  Api,
  AuthCheck,
  Context,
  Credential,
  CredentialStore,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { OpenAICompatibleProvider, WednesdayConfig } from "../core/config";
import { providerSecretName, type SecretStore } from "../core/secrets";

// Catalog `maxTokens` frequently reflects a model's advertised context
// window/ceiling rather than a real per-request output cap that every
// upstream actually honors (some OpenAI-compatible and OpenRouter-fronted
// upstreams reject requests above this even when the catalog advertises
// more). Clamp "auto" output-token requests to this value so maximizing
// output doesn't cause avoidable request failures.
const SAFE_MAX_OUTPUT_TOKENS = 32_000;
// Used when a model doesn't advertise maxTokens at all.
const FALLBACK_MAX_OUTPUT_TOKENS = 8_192;

export interface ModelCapabilities {
  provider: string;
  id: string;
  contextWindow: number | undefined;
  maxOutputTokens: number;
  reasoning: boolean;
  vision: boolean;
  toolCalling: true;
}

export class WednesdayModelManager {
  readonly models: ReturnType<typeof builtinModels>;
  model: Model<Api>;
  constructor(
    private readonly config: WednesdayConfig,
    private apiKey?: string,
    private readonly secrets?: SecretStore,
    // OpenAI-compatible custom providers are registered before the catalog is
    // queried, so they appear in `/models` alongside the built-ins.
    customProviders: OpenAICompatibleProvider[] = config.openaiCompatible,
  ) {
    // Bridge wednesday's OS-keychain `SecretStore` into pi-ai's credential
    // store so a key entered via the `/models` picker (or pre-stored at
    // startup) is what pi-ai's `checkAuth`/`getAvailable` resolve — without
    // this, pi-ai only sees env vars and never the keychain, so every
    // provider shows "(no key)" no matter what was entered.
    const credentialStore: CredentialStore = {
      read: async (providerId) => {
        const key = this.secrets
          ? await this.secrets.get(providerSecretName(providerId))
          : undefined;
        return key ? { type: "api_key", key } : undefined;
      },
      list: async () => [],
      modify: async (providerId, fn) => {
        const current = await credentialStore.read(providerId);
        const next = await fn(current);
        if (next?.type === "api_key" && next.key && this.secrets) {
          await this.secrets.set(providerSecretName(providerId), next.key);
        }
        return next;
      },
      delete: async (providerId) => {
        // `SecretStore` has no delete path; a blank write is rejected, so we
        // simply leave the entry untouched. Logout is unsupported in wednesday.
      },
    };
    this.models = builtinModels({ credentials: credentialStore });
    for (const spec of customProviders) {
      this.models.setProvider(createOpenAICompatibleProvider(spec));
    }
    const model = this.models.getModel(config.model.provider, config.model.id);
    if (!model) {
      const suggestions = this.models
        .getModels(config.model.provider)
        .slice(0, 8)
        .map((entry) => entry.id)
        .join(", ");
      throw new Error(
        `Unknown model: ${config.model.provider}/${config.model.id}. Available examples: ${suggestions || "none"}`,
      );
    }
    this.model = model;
  }
  /**
   * The largest output-token ceiling we'll request for the connected
   * model: an explicit config override, or an "auto" value derived from
   * the model's own advertised maxTokens, clamped to a safe upper bound.
   */
  effectiveMaxTokens(): number {
    const configured = this.config.model.maxOutputTokens;
    if (configured !== "auto") return configured;
    const advertised = this.model.maxTokens ?? FALLBACK_MAX_OUTPUT_TOKENS;
    return Math.min(advertised, SAFE_MAX_OUTPUT_TOKENS);
  }
  capabilities(): ModelCapabilities {
    return {
      provider: this.model.provider,
      id: this.model.id,
      contextWindow: this.model.contextWindow,
      maxOutputTokens: this.effectiveMaxTokens(),
      reasoning: Boolean(this.model.reasoning),
      vision: this.model.input.includes("image"),
      // pi-ai only catalogs models that support tool calling, so this is
      // always true for any model Wednesday can connect to.
      toolCalling: true,
    };
  }
  // Tuned defaults (reasoning depth, output ceiling, sampling temperature)
  // are applied first so Wednesday always maximizes the connected model's
  // usable capacity; an explicit per-call `options` argument, and then the
  // resolved API key, still take precedence over these defaults.
  stream = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const attribution = this.attributionHeaders(model.provider);
    return this.models.streamSimple(model, context, {
      reasoning: this.config.model.thinkingLevel,
      maxTokens: this.effectiveMaxTokens(),
      ...(this.config.model.temperature != null
        ? { temperature: this.config.model.temperature }
        : {}),
      ...(attribution ? { headers: attribution } : {}),
      ...options,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
    } as SimpleStreamOptions);
  };

  /**
   * OpenRouter app-attribution headers (HTTP-Referer / X-OpenRouter-Title /
   * X-OpenRouter-Categories) for the given provider. Returns undefined unless
   * attribution is configured with a `referer` (OpenRouter ignores the other
   * headers without one). Applied to the built-in `openrouter` provider and to
   * any OpenAI-compatible provider carrying its own `attribution` block.
   */
  private attributionHeaders(provider: string): Record<string, string> | undefined {
    const spec = this.config.openaiCompatible.find((p) => p.id === provider);
    const attr = spec?.attribution ?? this.config.attribution;
    if (!attr?.referer) return undefined;
    const headers: Record<string, string> = { "HTTP-Referer": attr.referer };
    if (attr.title) headers["X-OpenRouter-Title"] = attr.title;
    if (attr.categories) headers["X-OpenRouter-Categories"] = attr.categories;
    return headers;
  }
  get label() {
    return `${this.model.provider}/${this.model.id}`;
  }
  /**
   * The thinking levels this *specific* model actually supports, straight
   * from pi-ai's `getSupportedThinkingLevels` (which reads the model's
   * `thinkingLevelMap`, the `xhigh`/`max` opt-in levels, and provider
   * defaults). This is the authoritative source for the `/effort` command —
   * we no longer guess from a generic ladder.
   */
  supportedThinkingLevels(): string[] {
    return getSupportedThinkingLevels(this.model);
  }
  /**
   * The thinking levels for an arbitrary pi-ai catalog model (used by the
   * picker to show each candidate's real reasoning support, not a generic
   * ladder).
   */
  thinkingLevelsFor(model: Model<Api>): string[] {
    return getSupportedThinkingLevels(model);
  }
  /**
   * Per-provider auth readiness from pi-ai's `checkAuth`: whether a key or
   * OAuth credential is configured and where it came from. Undefined means
   * the provider is not configured (the model can't actually be used yet).
   */
  async authInfo(provider: string): Promise<AuthCheck | undefined> {
    return this.models.checkAuth(provider);
  }
  /**
   * Models whose owning provider is fully configured right now — pi-ai's
   * `getAvailable()`. Surfaces "you can use these immediately" vs the full
   * pi-ai catalog (which includes models you haven't added keys for yet).
   */
  async availableModels(): Promise<Set<string>> {
    const available = await this.models.getAvailable();
    return new Set(available.map((m) => `${m.provider}/${m.id}`));
  }
  /**
   * Re-resolve and activate a different model without rebuilding the
   * manager. Updates `this.model` (used by `capabilities()` and `stream()`)
   * and the backing config, then persists it. Throws if the model is
   * unknown so the caller can surface a clear error.
   */
  setModel(provider: string, id: string) {
    const model = this.models.getModel(provider, id);
    if (!model) {
      const examples = this.models
        .getModels(provider)
        .slice(0, 8)
        .map((entry) => entry.id)
        .join(", ");
      throw new Error(
        `Unknown model: ${provider}/${id}. Available examples: ${examples || "none"}`,
      );
    }
    this.model = model;
    this.config.model.provider = provider;
    this.config.model.id = id;
    return this.label;
  }
  async authStatus() {
    if (this.apiKey) return { source: "OS keychain", type: "api_key" as const };
    return this.models.checkAuth(this.model.provider);
  }
  /**
   * Record a freshly-entered API key (from the `/models` picker) so it is
   * used on the next stream. Only overrides the live `apiKey` for the
   * provider the agent is currently connected to — keys for other providers
   * are resolved by pi-ai from the OS keychain instead.
   */
  setApiKey(provider: string, key: string) {
    if (provider === this.model.provider) this.apiKey = key;
  }

  /**
   * Generate a short natural-language summary of `text` (used to condense
   * older conversation turns into a durable memory instead of archiving raw
   * excerpts). Best-effort: on any failure it returns "" so the caller can
   * fall back to the raw excerpt. Uses low reasoning and a small output cap
   * to keep the summarization cheap.
   */
  async summarize(text: string): Promise<string> {
    try {
      const stream = this.stream(
        this.model,
        { messages: [{ role: "user", content: text, timestamp: Date.now() }] },
        { reasoning: "low", maxTokens: 1024, temperature: 0.2 },
      );
      let out = "";
      for await (const event of stream) {
        if (event.type === "text_delta") out += event.delta;
      }
      const trimmed = out.trim();
      return trimmed.length >= 20 ? trimmed : "";
    } catch {
      return "";
    }
  }
}
