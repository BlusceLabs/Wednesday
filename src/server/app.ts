import type { WednesdayRuntime } from "../agent/runtime";
import { dashboardHtml } from "../dashboard/html";
import { createSerialQueue } from "../core/queue";
import type { ServerConfig } from "./config";
import { isAuthorized } from "./config";
import { gzipSync } from "node:zlib";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_PROMPT_CHARACTERS = 64_000;
const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 120 };

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(
  request: Request,
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  const text = JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  const headersOut = { ...headers, ...extraHeaders };
  // Compress responses the client asked for and that are large enough that
  // the CPU cost of gzip is worth the bytes saved on the wire — this cuts
  // transfer latency for the gateway (chat replies, /v1/journal, /v1/tools)
  // especially over slower, non-loopback links. Small bodies aren't worth
  // the round-trip of compressing and decompressing.
  if (request.headers.get("accept-encoding")?.includes("gzip") && bytes.length > 1024) {
    const compressed = gzipSync(bytes);
    return new Response(compressed, {
      status,
      headers: {
        ...headersOut,
        "content-encoding": "gzip",
        "content-length": String(compressed.length),
      },
    });
  }
  return new Response(bytes, {
    status,
    headers: { ...headersOut, "content-length": String(bytes.length) },
  });
}

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    (request as { headers: Headers }).headers.get("host") ??
    "unknown"
  );
}

/**
 * In-memory sliding-window rate limiter keyed by client address. This is
 * intentionally simple (single process, in-memory) — sufficient for a
 * personal-use HTTP gateway, not meant to replace a real reverse-proxy
 * rate limiter under multi-instance deployment.
 */
function createRateLimiter(config: { windowMs: number; max: number }) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const timestamps = (hits.get(key) ?? []).filter(
      (time) => now - time < config.windowMs,
    );
    timestamps.push(now);
    hits.set(key, timestamps);
    const remaining = Math.max(0, config.max - timestamps.length);
    return { allowed: timestamps.length <= config.max, remaining };
  };
}

async function readChatPrompt(request: Request): Promise<string | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES)
    return json(request, { error: "Request body too large" }, 413);
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      return json(request, { error: "Request body too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json(request, { error: "Expected a JSON body" }, 400);
  }
  const prompt =
    typeof body === "object" && body !== null && "prompt" in body
      ? String((body as { prompt: unknown }).prompt).trim()
      : "";
  if (!prompt) return json(request, { error: "prompt is required" }, 400);
  if (prompt.length > MAX_PROMPT_CHARACTERS)
    return json(request, { error: "prompt is too long" }, 413);
  return prompt;
}

export function createServerHandler(
  runtime: WednesdayRuntime,
  config: ServerConfig,
) {
  const queue = createSerialQueue();
  const serialized = <T>(work: () => Promise<T>) => queue.run(work);
  const rateLimit = createRateLimiter(config.rateLimit ?? DEFAULT_RATE_LIMIT);

  return async (request: Request) => {
    const url = new URL(request.url);

    const limit = rateLimit(clientKey(request));
    if (!limit.allowed)
      return json(request, { error: "Too many requests" }, 429, { "retry-after": "1" });

    // Gate the dashboard and every other route behind auth. For
    // localhost-only mode (no token) this resolves to "allow"; when bound
    // beyond loopback a server token is already required by
    // validateServerConfig, so this closes the gap where /dashboard and
    // /health were previously served without authentication.
    if (!isAuthorized(request, config))
      return json(request, { error: "Unauthorized" }, 401);

    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/dashboard")
    ) {
      const html = dashboardHtml;
      const accept = request.headers.get("accept-encoding") ?? "";
      if (accept.includes("gzip")) {
        const compressed = gzipSync(new TextEncoder().encode(html));
        return new Response(compressed, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "content-encoding": "gzip",
            "content-length": String(compressed.length),
          },
        });
      }
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json(request, { name: "Wednesday", version: "1.0.0-rc.7", status: "ok" });
    }

    if (request.method === "GET" && url.pathname === "/v1/tools") {
      return json(request, runtime.toolsInfo());
    }

    if (request.method === "GET" && url.pathname === "/v1/journal") {
      const limitParam = Number(url.searchParams.get("limit") ?? 50);
      const events = await runtime.journalTail(
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(limitParam, 500)
          : 50,
      );
      return json(request, { events });
    }

    if (request.method === "GET" && url.pathname === "/v1/session") {
      return json(request, await runtime.sessionInfo());
    }

    if (request.method === "GET" && url.pathname === "/v1/stats") {
      return json(request, runtime.stats());
    }

    if (request.method === "GET" && url.pathname === "/v1/vault") {
      const [stats, tags] = await Promise.all([
        runtime.vaultStats(),
        runtime.vaultTags(),
      ]);
      return json(request, { stats, tags });
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      return json(request, runtime.listModels());
    }

    if (request.method === "GET" && url.pathname === "/v1/skills") {
      return json(request, await runtime.skills());
    }

    if (request.method === "DELETE" && url.pathname === "/v1/session") {
      await serialized(() => runtime.submit("/clear"));
      return json(request, { cleared: true });
    }

    if (request.method === "POST" && url.pathname === "/v1/chat") {
      const promptOrResponse = await readChatPrompt(request);
      if (promptOrResponse instanceof Response) return promptOrResponse;
      const prompt = promptOrResponse;

      return serialized(async () => {
        let text = "";
        let error: string | undefined;
        const unsubscribe = runtime.events.subscribe((event) => {
          if (event.type === "assistant.delta") text += event.delta;
          if (event.type === "notice")
            text += `${text ? "\n" : ""}${event.message}`;
          if (event.type === "error") error = event.message;
        });
        try {
          await runtime.submit(prompt);
        } finally {
          unsubscribe();
        }
        return error
          ? json(request, { error, response: text || undefined }, 502)
          : json(request, { response: text, session: await runtime.sessionInfo() });
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/stream") {
      const promptOrResponse = await readChatPrompt(request);
      if (promptOrResponse instanceof Response) return promptOrResponse;
      const prompt = promptOrResponse;

      // Serialize through the same single-flight queue as /v1/chat so two
      // concurrent streaming requests can't both drive the agent at once
      // (the agent's message state is shared process-wide).
      return serialized(async () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (event: string, data: unknown) =>
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          const unsubscribe = runtime.events.subscribe((event) => {
            if (event.type === "assistant.delta")
              send("delta", { text: event.delta });
            else if (event.type === "thinking.delta")
              send("thinking", { text: event.delta });
            else if (event.type === "notice")
              send("notice", { text: event.message });
            else if (event.type === "tool.start")
              send("tool", { name: event.name, phase: "start" });
            else if (event.type === "tool.end")
              send("tool", { name: event.name, phase: "end", isError: event.isError });
            else if (event.type === "error") send("error", { message: event.message });
          });
          send("status", { value: "thinking" });
          try {
            await runtime.submit(prompt);
            send("done", { session: await runtime.sessionInfo(), ...runtime.lastTurnUsage() });
          } catch (error) {
            send("error", {
              message: error instanceof Error ? error.message : String(error),
            });
          } finally {
            unsubscribe();
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          connection: "keep-alive",
        },
      });
      });
    }

    // Vault export/import drive a full index rebuild (import) or a read of
    // every memory file (export), so they run through the same single-flight
    // queue as the chat routes — never concurrently with an in-flight agent
    // turn or with each other.
    if (request.method === "POST" && url.pathname === "/v1/vault/export") {
      return serialized(() => runtime.exportVault())
        .then((result) => json(request, result))
        .catch((error) =>
          json(
            request,
            { error: error instanceof Error ? error.message : String(error) },
            500,
          ),
        );
    }

    if (request.method === "POST" && url.pathname === "/v1/vault/import") {
      let body: unknown;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json(request, { error: "Expected a JSON body" }, 400);
      }
      const raw =
        body && typeof body === "object" && "path" in body
          ? String((body as { path: unknown }).path)
          : "";
      const merge =
        body && typeof body === "object" && "merge" in body
          ? Boolean((body as { merge: unknown }).merge)
          : false;
      if (!raw) return json(request, { error: "path is required" }, 400);
      return serialized(() => runtime.importVault(raw, merge))
        .then((result) => json(request, result))
        .catch((error) =>
          json(
            request,
            { error: error instanceof Error ? error.message : String(error) },
            500,
          ),
        );
    }

    // Switch the active model from the dashboard's model picker. Serialized
    // through the single-flight queue so the live agent's model pointer is
    // never reassigned mid-turn; setModel() persists the choice and emits a
    // model.changed event (visible in the audit log).
    if (request.method === "POST" && url.pathname === "/v1/models") {
      let body: unknown;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json(request, { error: "Expected a JSON body" }, 400);
      }
      const provider =
        body && typeof body === "object" && "provider" in body
          ? String((body as { provider: unknown }).provider)
          : "";
      const id =
        body && typeof body === "object" && "id" in body
          ? String((body as { id: unknown }).id)
          : "";
      if (!provider || !id)
        return json(request, { error: "provider and id are required" }, 400);
      return serialized(() => Promise.resolve(runtime.setModel(provider, id)))
        .then((label) => json(request, { label, provider, id }))
        .catch((error) =>
          json(
            request,
            { error: error instanceof Error ? error.message : String(error) },
            500,
          ),
        );
    }

    // Set the reasoning-effort level for the active model (dashboard
    // counterpart to the TUI's /effort). Serialized through the single-flight
    // queue so it never races an in-flight turn; setThinkingLevel() persists
    // the choice and journals an effort.changed event.
    if (request.method === "POST" && url.pathname === "/v1/models/effort") {
      let body: unknown;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json(request, { error: "Expected a JSON body" }, 400);
      }
      const level =
        body && typeof body === "object" && "level" in body
          ? String((body as { level: unknown }).level)
          : "";
      if (!level)
        return json(request, { error: "level is required" }, 400);
      return serialized(() => Promise.resolve(runtime.setThinkingLevel(level)))
        .then((next) => json(request, { level: next }))
        .catch((error) =>
          json(
            request,
            { error: error instanceof Error ? error.message : String(error) },
            500,
          ),
        );
    }

    return json(request, { error: "Not found" }, 404);
  };
}
