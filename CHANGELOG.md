# Changelog

## Unreleased

Local-first backup & restore for the memory vault:

- **Portable vault export.** A new `memory_export` tool and `/export` command write a self-describing JSON snapshot of the entire memory vault — every memory's frontmatter and body, preserving its folder and title — to `<home>/backups/wednesday-<timestamp>.json`. The backup lives alongside the vault and carries no secrets.
- **Vault import / restore.** `memory_import` and `/import <path> [--merge]` restore memories from an export. Each entry is placed back in its original folder using the same title-dedup and atomic temp-file write path as `remember`. Default mode is non-destructive: memories whose title already exists are skipped, so re-importing a backup never overwrites notes you've since changed; `--merge` (or `mode: "merge"`) overwrites them instead. The memory index is rebuilt after a restore so every imported memory is immediately searchable.
- **Path-confined imports.** Import paths are restricted to the user's home or workspace root (mirroring the single-root `resolveInside` boundary used elsewhere), so a crafted export path can't pull in files outside Wednesday's data.
- **Validated archives.** `parseArchive` rejects non-JSON or non-vault files with a clear error instead of failing deep inside the importer.
- **`remember` is now self-contained.** It creates its target folder before writing, so it no longer silently depends on a prior `initialize()` call (which previously left a never-initialized vault unable to remember anything).
- Wired across the terminal UI (Tools palette + command list), headless mode, and the `/v1/chat` HTTP API, with `vault.exported` / `vault.imported` audit-log events.

- **Vault insights.** New read-only `memory_stats` tool and `/stats` command summarize the vault — total memories, breakdown by type and folder, approximate word count, and the oldest/newest entries — so you can see how your knowledge base is growing at a glance. New `memory_tags` tool and `/tags` command aggregate every tag across the vault (with per-tag memory counts, most-used first), giving a quick view of how memories are organized. Both are wired through the UI, headless mode, and the HTTP API.

- **Faster vault reads.** The vault's file-scanning methods were I/O-heavy: `list()` and `findByTitle()` read every file *in full* just to grab the first heading, and `stats()` / `tags()` / `exportArchive()` each called `list()` (full reads) and then re-read every file *again* — three or four passes per file, all strictly sequential. They now share a single folder walk and read only a bounded 16 KB head (titles and tags always sit at the top of a memory file), with the per-file work fanned out under a bounded-concurrency pool (≤16 in flight). `list()` / `tags()` no longer pull pasted document bodies into memory, and `stats()` / `exportArchive()` collapse to a single pass. On a 400-memory / ~25 MB vault this is roughly a 2–3× speedup for `list()` and `tags()`, and the gap widens with larger memories since the old path read the entire body of every file.

- **Lower response latency.** The per-turn `prompt()` path awaited the `prompt.accepted` audit-log write *before* the model started streaming, so a disk write sat on the critical path to the first token. `EventJournal.append` is now internally serialized (a write chain) so concurrent appends can't fork the hash chain, and `prompt()` fires that audit entry without awaiting it — the model's network round-trip now overlaps the write instead of starting after it. Hash-chain integrity and ordering (including tool-event appends during a turn) are preserved, verified by a new concurrent-append test.

- **Compressed HTTP transport.** JSON API responses (chat replies, `/v1/journal`, `/v1/tools`, sessions) and the dashboard HTML are now gzip-compressed when the client sends `Accept-Encoding: gzip` and the payload exceeds ~1 KB — cutting transfer latency over slower, non-loopback links without paying gzip's cost on tiny bodies. The SSE `/v1/chat/stream` path is intentionally left uncompressed (streaming + gzip interact poorly). Covered by new server tests.

- **Faster dashboard boot.** The dashboard's initial data load (health, tools, session) now fetches those three endpoints in parallel instead of sequentially, so the UI is interactive sooner.

## 1.0.0-rc.8

Hardening, correctness, and quality pass on top of rc.7:

- **Real conversation summarization.** Auto-summarization now asks the model for a genuine condensed summary of older turns (falling back to raw excerpts only if the model call fails) instead of archiving verbatim excerpts under the "summary" label.
- **Swappable embeddings.** Memory vectors now flow through a stable `Embedder` interface (`memory.embedder: "hash" | "onnx"`); the bundled hashed bag-of-words embedder is the default, and an ONNX-backed local embedder is a documented extension point for true paraphrase recall.
- **Memory hygiene.** `vault.remember` now updates an existing memory with the same title in place instead of creating duplicate files, and adds `vault.forget(title)` plus a `/forget` command (and `vault.list()`) for memory pruning.
- **Args-aware permissions.** `PermissionService` now takes the configured `git.remote` and refuses `git_push`/`git_pull` to any other remote, closing a prompt-injection path that could redirect the sync destination.
- **`config set` validates before saving.** Writing a setting now runs `validateSettings` and refuses to persist invalid values instead of saving them silently.
- **Security boundary tests.** Added direct unit tests for the SSRF guard (`BrowserUse.validate` + the extracted `robotsDisallows`) and the permission allow/block policy, so the confinement boundary is locked at its source rather than only via tool mocks.
- Carries forward from rc.7: `browser_screenshot` enforces the shared private-host/robots policy, `computer_apply_patch` rejects patches escaping the workspace, the dashboard and `/health` are auth-gated, all agent entry points are serialized through a single-flight queue, `memory_remember` uses incremental `index.sync`, and the runtime mutex is unit-tested.

## 1.0.0-rc.7

Maximizes whatever model Wednesday is connected to, instead of using conservative defaults:

- **Deepest reasoning by default.** The agent's "thinking level" was hardcoded to `medium`; it's now driven by a new `model.thinkingLevel` setting (default `high`), so Wednesday always asks the connected model to reason as deeply as it supports. Models without reasoning support ignore this safely.
- **Maximized, safely-clamped output length.** Added `model.maxOutputTokens` (default `"auto"`), which requests the model's own advertised output ceiling instead of an unset/low default — clamped to a defensive cap so it doesn't exceed real per-request limits some upstreams enforce below their advertised catalog maximum.
- **Tuned sampling.** Added `model.temperature` (default `0.3`), favoring precise, consistent answers for an agentic/coding assistant; configurable or can be set to `null` to defer to the provider's own default. Note: `top_p` remains unavailable — the underlying model SDK has no unified field for it across providers.
- **Vision wired up.** The `browser_screenshot` tool now attaches the actual captured image to its result when the connected model supports image input, so a vision-capable model can see the screenshot directly instead of only getting a saved file path.
- **Richer `/model` command.** `/model` now reports the active model's context window, effective max output tokens, reasoning/vision/tool-calling support, and the current temperature and thinking-level settings.
- Tool calling and structured output were already fully available for every catalog model (tool calling is required for any model Wednesday can connect to; structured output is achieved via the existing typed tool schemas) — no changes needed there.

## 1.0.0-rc.6

Latency and throughput pass — no new tools, focused entirely on making Wednesday feel faster:

- **Parallel startup.** `bootstrap()` used to initialize the vault, memory index, journal, session store, git history, and OS keychain lookup one after another; independent steps now run concurrently with `Promise.all`, so startup time is bounded by the slowest single step instead of their sum.
- **Incremental memory indexing.** The memory index used to fully wipe and re-embed every markdown file in the vault on every startup, every `/remember`, and every automatic conversation summarization. It now calls a new `MemoryIndex.sync()` that only re-reads and re-embeds files that are new or changed (by mtime) and removes rows for deleted files — indexing cost now scales with what changed, not with total vault size. `/reindex` still runs a full rebuild when you deliberately want one.
- **In-memory journal tail cache.** The dashboard's Audit log panel and the `GET /v1/journal` API used to re-read and re-parse the entire append-only event journal file from disk on every request/poll. `EventJournal` now keeps a bounded in-memory cache of the most recent events, updated on every `append()`, so `tail()` is served from memory with no disk I/O on the hot path.

## 1.0.0-rc.5

- Added a local, dependency-free hashed-embedding semantic layer that supplements SQLite FTS5 keyword search in `memory_search`/`/recall`.
- Added a memory staleness/review workflow: `MemoryIndex.stale()` and the new `/stale` local command.
- Added cross-session summarization: conversations longer than `session.summarizeAfterMessages` are condensed into a durable vault memory and trimmed automatically, keeping the most recent `session.keepRecentMessages`.
- Added a proactive scheduler (`scheduler.tasks`, `wednesday config schedule add/list/remove`) that runs configured prompts on an interval while a Wednesday process is running.
- Added approval-gated `git_push`/`git_pull` tools and a `git.remote` config option, so a Wednesday identity can follow you across machines.
- Added the approval-gated `browser_screenshot` tool for full-page PNG capture with headless Chromium.
- Added the approval-gated `computer_apply_patch` tool for multi-file unified-diff patches in a single call.
- Added a dashboard Audit log panel and a `GET /v1/journal` API backed by the existing hash-chained event journal.
- Added per-client HTTP rate limiting (`server.rateLimit`) across every `/v1/*` route.
- Added `wednesday config validate` to check settings for unsafe or inconsistent values before saving or deploying.
- Added the approval-gated `voice_speak` tool, shelling out to OS-native text-to-speech (`say`/`espeak-ng`/`espeak`/`spd-say`/PowerShell).
- Added pluggable calendar/email adapter stubs (`calendar_list_events`, `email_list_messages`, `integrations.calendar`/`integrations.email`); only `provider: "none"` ships and throws a clear configuration error otherwise — no OAuth client is bundled.
- Added packaging scaffolding: a Homebrew formula template, an unsigned macOS `.app` build script, and an NSIS Windows installer template, each documenting the signing/publishing steps that still require real credentials outside this environment.
- Fixed a permission-check ordering gap so `git_push`/`git_pull` always require approval instead of being auto-allowed by the generally-safe `git_` prefix.
- Expanded the core tool registry to 106 tools.

## 1.0.0-rc.4

- Wired all eight local commands (`/help`, `/model`, `/remember`, `/recall`, `/reindex`, `/clear`, `/session`, `/history`) consistently across the terminal UI, headless mode, and the `/v1/chat` HTTP API.
- Terminal UI footer now lists every local command instead of a partial subset.
- Terminal UI approval preview now renders tailored details for every approvable tool, including `browser_use`, `cloakbrowser_use`, `scrapling_extract`, `computer_write_file`, `computer_edit_file`, and `computer_terminal`.
- Documented the local command table in `README.md`.

## 1.0.0-rc.3

- Added direct computer-use tools: `computer_write_file`, `computer_edit_file`, and `computer_terminal`.
- `computer_terminal` runs inside the Docker sandbox when it is enabled, otherwise directly against the workspace root.
- All three computer tools are approval-gated and confined to the configured workspace directory.
- Expanded the core tool registry to 85 tools (86 with the optional Docker sandbox).

## 1.0.0-rc.2

- Added tag-driven GitHub release automation.
- Added ZIP and tar.gz archives with SHA-256 checksums.
- Added artifact uploads and build-provenance attestations.
- Added release dry runs and dependency update automation.

## 1.0.0-rc.1

- Removed `.env` configuration and added an OS-native JSON settings service.
- Added OS keychain/Secret Service/DPAPI credential storage.
- Added pinned CloakBrowser 0.4.10 and Scrapling 0.4.9 adapters.
- Added `cloakbrowser_use` and `scrapling_extract` tools.
- Added SSRF protection, robots policy, URL validation, and bounded browser output.
- Added dashboard/API approval polling and one-time decisions.
- Added graceful shutdown, CI, deployment documentation, and a security policy.
- Expanded the core registry to 82 tools.

## 0.8.0

- Added a responsive web dashboard with chat, metrics, session controls, and tool search.
- Expanded the core registry to 80 tools across memory, text, math, date, data, workspace, Git, and browser groups.
- Added the approval-gated `browser_use` headless Chromium tool.
- Added path-contained workspace readers and fixed-template read-only Git tools.
- Added browser diagnostics, a tools API, and tool-count tests.

## 0.7.0

- Added a localhost-first HTTP gateway.
- Added health, chat, session, and session-clear endpoints.
- Added bearer-token enforcement for non-loopback bindings.
- Added request-size limits and serialized agent execution.
- Added gateway diagnostics and security tests.
- Documented private remote access through Tailscale.

## 0.6.0

- Renamed the assistant and project from ANA to Wednesday.
- Renamed the CLI binary to `wednesday`.
- Renamed environment variables to the `WEDNESDAY_` prefix.
- Renamed the default data directory to `.wednesday`.
- Renamed Docker container and local Git identities.

## 0.5.0

- Added an optional Docker command sandbox.
- Added per-command human approval.
- Disabled sandbox networking.
- Added read-only root filesystem and resource limits.
- Added sandbox diagnostics and a manual test command.
- Added sandbox audit events.

## 0.4.0

- Added interactive tool approvals.
- Added agent-proposed durable memory writes.
- Added approval preview and keyboard controls.
- Added deny-by-default headless behavior.
- Added approval audit events.

## 0.3.0

- Added persistent conversation sessions.
- Added read-only memory search and read tools.
- Added automatic local Git history for durable memories.
- Added session, clear, and history commands.
- Expanded diagnostics.

## 0.2.0

- Adopted Pi AI's current `builtinModels()` API.
- Added model streaming, local memory commands, and Models.dev caching.

## 0.1.0

- Initial Pi Agent Core, OpenTUI, Markdown vault, FTS5, and journal scaffold.
