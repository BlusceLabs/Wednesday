import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { OpenAICompatibleProvider as Spec } from "../core/config";

/**
 * Builds a pi-ai `Provider` for an OpenAI-compatible `/v1` endpoint
 * (Novita, SiliconFlow, Featherless, UnoRouter, Agnes, self-hosted vLLM,
 * etc.). The model list and credentials come entirely from Wednesday's
 * `openaiCompatible` config — no OS keychain or env var is consulted.
 *
 * Most third-party gateways only implement the Chat Completions API, so
 * that is the default (`api: "completions"`). The newer Responses API is
 * only used when a provider explicitly opts in via `api: "responses"`.
 * Failing to match the gateway's supported shape is what produced the
 * `404` errors against providers like Novita that have no `/responses`
 * route.
 */
export function createOpenAICompatibleProvider(
  spec: Spec,
): Provider<"openai-responses" | "openai"> {
  const id = spec.id;
  const name = spec.name ?? spec.id;
  const useResponses = (spec.api ?? "completions") === "responses";
  const api = useResponses ? openAIResponsesApi() : openAICompletionsApi();
  const models: Model<"openai-responses" | "openai">[] = spec.models.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    api: useResponses ? "openai-responses" : "openai",
    provider: id,
    baseUrl: spec.baseURL,
    reasoning: m.reasoning,
    input: m.vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    // Third-party OpenAI-compatible gateways (Novita, SiliconFlow,
    // Featherless, UnoRouter, Agnes, vLLM, …) implement the *standard*
    // Chat Completions shape, where the system prompt is sent as
    // `role: "system"`. pi-ai auto-detects these as OpenAI and upgrades
    // it to `role: "developer"`, which Novita rejects with a bare `400`
    // (no body). Pin the legacy system role so the request is accepted.
    compat: { supportsDeveloperRole: false },
  }));

  return createProvider({
    id,
    name,
    baseUrl: spec.baseURL,
    auth: {
      apiKey: {
        name: `${name} API key`,
        resolve: async () => ({
          auth: { apiKey: spec.apiKey, baseUrl: spec.baseURL },
          source: "wednesday config",
        }),
      },
    },
    // OpenRouter app-attribution headers (HTTP-Referer / X-OpenRouter-Title /
    // X-OpenRouter-Categories). Only attached when a referer is set, since
    // OpenRouter ignores attribution without it.
    ...(spec.attribution?.referer
      ? {
          headers: {
            "HTTP-Referer": spec.attribution.referer,
            ...(spec.attribution.title
              ? { "X-OpenRouter-Title": spec.attribution.title }
              : {}),
            ...(spec.attribution.categories
              ? { "X-OpenRouter-Categories": spec.attribution.categories }
              : {}),
          },
        }
      : {}),
    models,
    api,
  });
}
