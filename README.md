# Wednesday 1.0 RC

A local-first personal agent built on Pi Agent Core, Pi AI, OpenTUI, durable Markdown memory, an authenticated dashboard, and a 106-tool registry.

## Performance (rc.6)

This release is a latency-focused pass with no new tools:

- **Parallel startup.** Vault, memory index, journal, session store, git history, and the OS keychain lookup now initialize concurrently instead of one after another, so startup time is bounded by the slowest single step.
- **Incremental memory indexing.** `MemoryIndex.sync()` only re-embeds vault files that are new or changed (by modification time) and removes rows for deleted files, instead of wiping and re-embedding the entire vault on every startup, `/remember`, and auto-summarization. `/reindex` still does a full rebuild when you deliberately want one.
- **In-memory journal tail cache.** The dashboard Audit log panel and `GET /v1/journal` are served from a bounded in-memory cache instead of re-reading and re-parsing the whole event journal file on every poll.

## Production-candidate upgrades (rc.5)

- **Semantic memory recall.** A local, dependency-free hashed-embedding layer (`memory_search`/`/recall`) supplements SQLite FTS5 keyword search with paraphrase-tolerant ranking — no network calls or model downloads.
- **Memory staleness review.** `/stale` and `MemoryIndex.stale()` surface vault memories that have not been touched recently, so outdated notes can be reviewed instead of silently rotting.
- **Cross-session summarization.** Once a conversation passes `session.summarizeAfterMessages` messages, older turns are condensed into a durable vault memory and trimmed from the live session automatically, keeping the most recent `session.keepRecentMessages`.
- **Proactive scheduler.** `scheduler.tasks` runs configured prompts on an interval while Wednesday is running (not a background daemon — pair with OS cron + `bun run headless` for always-on scheduling).
- **Git remote sync.** Approval-gated `git_push`/`git_pull` tools (plus the config-cli) let one Wednesday identity follow you across machines via `git.remote`.
- **`browser_screenshot`.** Captures a full-page PNG with headless Chromium for visual review.
- **`computer_apply_patch`.** Applies a multi-file unified diff in one call instead of many `computer_edit_file` round trips.
- **Dashboard audit log.** The dashboard now has an Audit log panel backed by `GET /v1/journal`, browsing the existing hash-chained event journal.
- **HTTP rate limiting.** Every `/v1/*` route is protected by a per-client fixed-window rate limit (`server.rateLimit`).
- **`wednesday config validate`.** Checks the full settings file for unsafe or inconsistent values before you save or deploy.
- **`voice_speak`.** Speaks text out loud via the OS-native TTS engine (`say`/`espeak`/`spd-say`/PowerShell).
- **Calendar/email adapter stubs.** `calendar_list_events`/`email_list_messages` and `integrations.calendar`/`integrations.email` define a pluggable provider shape; only `provider: "none"` ships today and throws a clear configuration error otherwise.
- **Packaging scaffolding.** Homebrew formula template, unsigned macOS `.app` builder script, and an NSIS installer template under `packaging/` (none are signed/published — see the comments in each file for what's still required).

## Earlier production-candidate upgrades

- **No `.env` file.** Non-secret settings live in the OS config directory.
- **No plaintext secrets.** Model keys and server tokens use macOS Keychain, Linux Secret Service, or Windows DPAPI.
- **CloakBrowser 0.4.10** adapter for stealth Chromium.
- **Scrapling 0.4.9** adapter for adaptive extraction.
- `browser_use`, `cloakbrowser_use`, and `scrapling_extract` with per-action approval.
- `computer_write_file`, `computer_edit_file`, and `computer_terminal` for direct workspace file writes and shell access, each requiring approval and confined to the configured workspace root.
- SSRF protection, HTTP(S)-only URLs, robots policy, timeouts, and bounded output.
- Dashboard/API approval workflow so protected tools can be reviewed remotely.
- Graceful SIGINT/SIGTERM shutdown.
- Pinned dependencies, CI, deployment runbook, and security policy.

## Upgrade from ANA/Wednesday 0.x

```bash
bun run migrate
```

The migrator copies `.ana` data into the native data directory, moves supported settings into `config.json`, stores a discovered model key in the OS secret store, and renames `.env` to `.env.retired`.

## Local commands

All nine commands are wired in the terminal UI, headless mode, and the `/v1/chat` HTTP API (send the command text as the `prompt`):

| Command                          | Effect                                             |
| -------------------------------- | -------------------------------------------------- |
| `/help`                          | List local commands                                |
| `/model`                         | Show the active model                              |
| `/remember Title :: Memory text` | Save a durable memory                              |
| `/recall search terms`           | Search the memory vault (keyword + semantic)       |
| `/reindex`                       | Fully rebuild the memory index                     |
| `/clear`                         | Clear the current conversation (memories are kept) |
| `/session`                       | Show persistent-session information                |
| `/history`                       | Show recent memory commits                         |
| `/stale`                         | List memories that have not been touched recently  |
| `/forget Title`                  | Delete a memory by title                           |
| `/export`                        | Back up the whole memory vault to a portable file  |
| `/import <path> [--merge]`        | Restore memories from a vault backup file          |
| `/stats`                         | Show vault size and breakdown by type/folder        |
| `/tags`                          | List tags used across memories, most-used first     |

## Install

```bash
bun install
bun run config -- init
bun run setup:browser
```

Store the model key without putting it in shell history:

```bash
read -s MODEL_KEY
printf '%s' "$MODEL_KEY" | bun run config -- secret set anthropic
unset MODEL_KEY
```

Configure normal settings:

```bash
bun run config -- set workspace /absolute/path/to/projects
bun run config -- set browser.backend auto
bun run config -- validate
bun run config -- show
bun run doctor
bun test
bun run check
```

## Run

```bash
bun run dev       # terminal UI
bun run serve     # dashboard and API
```

Dashboard: `http://127.0.0.1:4317/dashboard` (includes an Audit log panel)

## Proactive scheduling

```bash
bun run config -- schedule add "Morning briefing" "Summarize anything I should know this morning." 1440
bun run config -- schedule list
bun run config -- schedule remove <id>
```

Scheduled tasks only fire while a Wednesday process (terminal UI or `bun run serve`/`headless`) is running. For always-on scheduling, use an OS cron / launchd / Task Scheduler entry that runs `bun run headless "prompt"`.

## Git remote sync

```bash
bun run config -- set git.remote git@github.com:you/wednesday-memory.git
```

Then use the approval-gated `git_push`/`git_pull` tools from a conversation, or run `git push`/`git pull` yourself in the workspace.

## Browser and computer tools

- `browser_use`: automatic routing; CloakBrowser when installed, Chromium fallback.
- `cloakbrowser_use`: force CloakBrowser stealth Chromium.
- `browser_screenshot`: capture a full-page PNG screenshot for visual review.
- `computer_write_file` / `computer_edit_file` / `computer_apply_patch`: create, overwrite, append, precisely patch, or multi-file diff-patch workspace files.
- `computer_terminal`: run a shell command; uses the Docker sandbox when enabled, otherwise runs directly against the workspace.
- `scrapling_extract`: adaptive static/stealth extraction with an optional CSS selector.

Browser actions require explicit approval. Private and loopback destinations are blocked by default. Wednesday respects `robots.txt` by default. Use only where authorized and comply with website terms and applicable law.

## Configuration

```bash
bun run config -- path
bun run config -- show
bun run config -- validate
bun run config -- set model.id claude-sonnet-4-6
bun run config -- secret status anthropic
```

Linux config: `~/.config/wednesday/config.json`  
Linux data: `~/.local/share/wednesday/`

The equivalent native application directories are used on macOS and Windows.

For non-local dashboard binding, store a strong token:

```bash
openssl rand -hex 32 | bun run config -- secret set server:token
bun run config -- set server.host 0.0.0.0
```

Prefer a private overlay such as Tailscale rather than exposing Wednesday directly. Every `/v1/*` route is also rate-limited (`server.rateLimit`, default 120 requests/minute).

## Packaging

Starting scaffolding lives under `packaging/`:

- `packaging/homebrew/wednesday.rb` — Homebrew formula template (checksums must be filled in per release).
- `packaging/macos/build-app.sh` — builds an unsigned `Wednesday.app` for local use (code signing/notarization require a real Apple Developer ID and must be run separately).
- `packaging/windows/installer.nsi` — NSIS installer template (building the `.exe` requires running `makensis`; signing requires a real code-signing certificate).

## Release gate

Before promoting the RC to production:

```bash
bun install
bun run setup:browser
bun run config -- validate
bun run doctor
bun test
bun run check
```

Full browser smoke tests require network access and must target sites you control.
