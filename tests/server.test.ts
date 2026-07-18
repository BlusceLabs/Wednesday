import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import type { WednesdayRuntime } from "../src/agent/runtime";
import { WednesdayEventBus } from "../src/core/events";
import { createServerHandler } from "../src/server/app";
import { isAuthorized, validateServerConfig } from "../src/server/config";

describe("server security", () => {
  test("requires a strong token beyond localhost", () => {
    expect(() => validateServerConfig({ host: "0.0.0.0", port: 4317 })).toThrow(
      "server token",
    );
    expect(() =>
      validateServerConfig({
        host: "0.0.0.0",
        port: 4317,
        token: "x".repeat(24),
      }),
    ).not.toThrow();
  });

  test("compares bearer tokens", () => {
    const config = {
      host: "0.0.0.0",
      port: 4317,
      token: "secret-token-that-is-long-enough",
    };
    expect(
      isAuthorized(
        new Request("http://localhost", {
          headers: { authorization: `Bearer ${config.token}` },
        }),
        config,
      ),
    ).toBe(true);
    expect(
      isAuthorized(
        new Request("http://localhost", {
          headers: { authorization: "Bearer wrong" },
        }),
        config,
      ),
    ).toBe(false);
  });

  test("serves health and serialized chat", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({
        messages: 1,
        updatedAt: null,
        path: "/private/session.json",
      }),
      toolsInfo: () => ({ total: 82, tools: [] }),
      submit: async () =>
        events.emit({ type: "notice", message: "Hello from Wednesday" }),
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    expect((await handler(new Request("http://localhost/health"))).status).toBe(
      200,
    );
    const response = await handler(
      new Request("http://localhost/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Hello" }),
      }),
    );
    expect(await response.json()).toMatchObject({
      response: "Hello from Wednesday",
    });
  });

  test("gzips large JSON responses only when requested", async () => {
    const events = new WednesdayEventBus();
    const big = Array.from({ length: 400 }, (_, i) => ({
      name: `tool_${i}`,
      label: `Tool ${i}`,
      description: "pad".repeat(8),
      category: "t",
      group: "T",
    }));
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: big.length, tools: big }),
      submit: async () => {},
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    const gz = await handler(
      new Request("http://localhost/v1/tools", {
        headers: { "accept-encoding": "gzip" },
      }),
    );
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const decoded = JSON.parse(
      gunzipSync(Buffer.from(await gz.arrayBuffer())).toString("utf8"),
    );
    expect(decoded.total).toBe(big.length);
    const plain = await handler(new Request("http://localhost/v1/tools"));
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect((await plain.json()).total).toBe(big.length);
  });

  test("gzips the dashboard HTML when requested", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      submit: async () => {},
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    const gz = await handler(
      new Request("http://localhost/dashboard", {
        headers: { "accept-encoding": "gzip" },
      }),
    );
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const html = gunzipSync(Buffer.from(await gz.arrayBuffer())).toString("utf8");
    expect(html).toContain("Wednesday");
  });

  test("dashboard wires in the audit log panel backed by /v1/journal", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      submit: async () => {},
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    const html = await (
      await handler(new Request("http://localhost/dashboard"))
    ).text();
    // The Audit log view, its nav entry, and the live polling that reads
    // the hash-chained journal must all be present.
    expect(html).toContain('id="view-audit"');
    expect(html).toContain('data-view="audit"');
    expect(html).toContain("loadAudit");
    expect(html).toContain("/v1/journal");
  });

  test("streamed done event carries per-turn usage so dashboard charts fill in", async () => {
    const events = new WednesdayEventBus();
    let captured = {} as Record<string, unknown>;
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 3, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      lastTurnUsage: () => ({ tokens: 1234, model: "anthropic/claude-sonnet-4-6" }),
      submit: async () => {
        events.emit({ type: "status", value: "thinking" });
        events.emit({ type: "assistant.done" });
        events.emit({ type: "status", value: "ready" });
      },
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    const res = await handler(
      new Request("http://localhost/v1/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Hello" }),
      }),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    const done = body.match(/event: done\ndata: (\{.*\})/);
    expect(done).not.toBeNull();
    captured = JSON.parse(done![1]);
    expect(captured.tokens).toBe(1234);
    expect(captured.model).toBe("anthropic/claude-sonnet-4-6");
    expect(captured.session).toMatchObject({ messages: 3 });
  });

  test("dashboard wires in the memory vault view (stats + tags + export/import)", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      vaultStats: async () => ({
        total: 7,
        byType: { note: 5, project: 2 },
        byFolder: { inbox: 7 },
        totalWords: 1200,
        oldest: { title: "First", path: "/v/a.md", ageDays: 40 },
        newest: { title: "Last", path: "/v/b.md", ageDays: 1 },
      }),
      vaultTags: async () => [
        { tag: "home", count: 4 },
        { tag: "work", count: 2 },
      ],
      exportVault: async () => ({ count: 7, path: "/tmp/wednesday-export.json" }),
      importVault: async (path: string, merge: boolean) => ({
        imported: 3,
        updated: 1,
        skipped: 0,
        path,
      }),
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    // GET /v1/vault returns stats + tags together.
    const vault = await (
      await handler(new Request("http://localhost/v1/vault"))
    ).json();
    expect(vault.stats.total).toBe(7);
    expect(vault.tags).toHaveLength(2);
    // POST /v1/vault/export backs up the vault.
    const exported = await (
      await handler(
        new Request("http://localhost/v1/vault/export", { method: "POST" }),
      )
    ).json();
    expect(exported.count).toBe(7);
    // POST /v1/vault/import restores from a path, requiring `path`.
    const imported = await (
      await handler(
        new Request("http://localhost/v1/vault/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "/tmp/wednesday-export.json", merge: true }),
        }),
      )
    ).json();
    expect(imported.imported).toBe(3);
    const missingPath = await handler(
      new Request("http://localhost/v1/vault/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(missingPath.status).toBe(400);
    // The dashboard HTML exposes the memory vault view + its controls.
    const html = await (await handler(new Request("http://localhost/dashboard"))).text();
    expect(html).toContain('id="view-memory"');
    expect(html).toContain('data-view="memory"');
    expect(html).toContain("exportVault");
    expect(html).toContain("importVault");
    expect(html).toContain("/v1/vault");
  });

  test("dashboard model picker lists and switches the active model", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      listModels: () => [
        { provider: "anthropic", id: "claude-a", name: "Claude A", api: "anthropic", active: true, reasoning: true, vision: true, thinkingLevels: ["low", "high"], contextWindow: 200000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
        { provider: "openai", id: "gpt-b", name: "GPT B", api: "openai", active: false, reasoning: false, vision: false, thinkingLevels: [], contextWindow: 128000, cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 } },
      ],
      setModel: async (provider: string, id: string) => `${provider}/${id}`,
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    const models = await (await handler(new Request("http://localhost/v1/models"))).json();
    expect(models).toHaveLength(2);
    expect(models[0].active).toBe(true);
    // Switching posts provider/id and returns the new label.
    const switched = await (
      await handler(
        new Request("http://localhost/v1/models", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "openai", id: "gpt-b" }),
        }),
      )
    ).json();
    expect(switched.label).toBe("openai/gpt-b");
    const missing = await handler(
      new Request("http://localhost/v1/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai" }),
      }),
    );
    expect(missing.status).toBe(400);
    // The dashboard exposes the models view + its controls.
    const html = await (await handler(new Request("http://localhost/dashboard"))).text();
    expect(html).toContain('id="view-models"');
    expect(html).toContain('data-view="models"');
    expect(html).toContain("/v1/models");
  });

  test("dashboard surfaces live status (active model + context + cache)", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      stats: () => ({
        usage: { input: 1000, output: 500, total: 1500 },
        cacheHitPct: 42.5,
        contextTokens: 8000,
        contextWindow: 200000,
        contextPct: 4,
        maxOutput: 8192,
        maxOutputAuto: false,
        modelId: "anthropic/claude-sonnet-4-6",
        thinkingLevel: "medium",
        workspace: "/tmp",
      }),
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    const stats = await (await handler(new Request("http://localhost/v1/stats"))).json();
    expect(stats.modelId).toBe("anthropic/claude-sonnet-4-6");
    expect(stats.contextPct).toBe(4);
    expect(stats.cacheHitPct).toBe(42.5);
    // The overview exposes the live status strip.
    const html = await (await handler(new Request("http://localhost/dashboard"))).text();
    expect(html).toContain('id="statusRow"');
    expect(html).toContain('id="statModel"');
    expect(html).toContain('id="statContext"');
    expect(html).toContain('id="statCache"');
    expect(html).toContain("loadStats");
    expect(html).toContain("/v1/stats");
  });

  test("dashboard effort selector sets the active model's reasoning level", async () => {
    const events = new WednesdayEventBus();
    let effort = "medium";
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      stats: () => ({ modelId: "anthropic/claude-sonnet-4-6", thinkingLevel: effort, contextPct: 0, cacheHitPct: 0 }),
      listModels: () => [
        { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet", api: "anthropic", active: true, reasoning: true, vision: true, thinkingLevels: ["off", "low", "medium", "high"], contextWindow: 200000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      ],
      setThinkingLevel: async (level: string) => {
        effort = level;
        return level;
      },
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    // POST /v1/models/effort sets and persists the level.
    const set = await (
      await handler(
        new Request("http://localhost/v1/models/effort", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ level: "high" }),
        }),
      )
    ).json();
    expect(set.level).toBe("high");
    const missing = await handler(
      new Request("http://localhost/v1/models/effort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(missing.status).toBe(400);
    // The models view exposes the effort selector.
    const html = await (await handler(new Request("http://localhost/dashboard"))).text();
    expect(html).toContain('class="effortrow"');
    expect(html).toContain("setEffort");
    expect(html).toContain("/v1/models/effort");
  });

  test("dashboard wires in the skills registry (agentskills.io)", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      skills: async () => [
        { name: "commit-style", description: "Write conventional commits.", version: "1.0.0", license: "MIT", dir: "/s/commit-style", path: "/s/commit-style/SKILL.md", content: "Use Conventional Commits." },
      ],
    } as unknown as WednesdayRuntime;
    const handler = createServerHandler(runtime, {
      host: "127.0.0.1",
      port: 4317,
    });
    // GET /v1/skills returns the installed skills with their content.
    const skills = await (await handler(new Request("http://localhost/v1/skills"))).json();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("commit-style");
    expect(skills[0].content).toContain("Conventional Commits");
    // The dashboard exposes the skills view.
    const html = await (await handler(new Request("http://localhost/dashboard"))).text();
    expect(html).toContain('id="view-skills"');
    expect(html).toContain('data-view="skills"');
    expect(html).toContain("loadSkills");
    expect(html).toContain("/v1/skills");
  });

  test("gates dashboard and health behind auth beyond localhost", async () => {
    const events = new WednesdayEventBus();
    const runtime = {
      events,
      sessionInfo: async () => ({ messages: 0, updatedAt: null, path: "" }),
      toolsInfo: () => ({ total: 0, tools: [] }),
      submit: async () => {},
    } as unknown as WednesdayRuntime;
    const open = createServerHandler(runtime, { host: "0.0.0.0", port: 4317 });
    // Without a token, endpoints beyond loopback must be refused — this
    // closes the gap where /dashboard and /health were previously served
    // unauthenticated.
    expect((await open(new Request("http://x/dashboard"))).status).toBe(401);
    expect((await open(new Request("http://x/health"))).status).toBe(401);
    const token = "x".repeat(24);
    const authed = createServerHandler(runtime, {
      host: "0.0.0.0",
      port: 4317,
      token,
    });
    expect(
      (
        await authed(
          new Request("http://x/dashboard", {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await authed(
          new Request("http://x/health", {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(200);
  });
});
