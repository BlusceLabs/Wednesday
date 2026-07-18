# Security policy

## Boundaries

- Secrets are never accepted in JSON configuration or `.env` files.
- Browser/network tools require one-time approval.
- Private, loopback, link-local, and RFC1918 targets are blocked by default.
- Read-only `workspace_*` tools are path-contained and cannot write.
- `computer_write_file`, `computer_edit_file`, `computer_apply_patch`, and `computer_terminal` are path-contained, always require one-time approval, and route through the Docker sandbox when it is enabled.
- `git_push` and `git_pull` always require approval even though other `git_*` tools are read-only and safe by default — the `APPROVABLE` list is checked before any prefix-based safety rule.
- `browser_screenshot`, `calendar_list_events`, `email_list_messages`, and `voice_speak` are approval-gated like the other network/IO tools.
- Git tools use fixed argument templates without a shell.
- Docker execution is disabled by default and uses no network, a read-only root, dropped capabilities, and resource limits.
- The HTTP gateway applies a per-client fixed-window rate limit (`server.rateLimit`, default 120 requests/minute) to every `/v1/*` route.

## Browser automation

CloakBrowser and Scrapling are for authorized automation and research. Do not use Wednesday to bypass access controls, CAPTCHAs, rate limits, terms of service, or applicable privacy/data-protection law. Keep `respectRobots` enabled.

## Calendar and email integrations

`integrations.calendar` and `integrations.email` ship with `provider: "none"` by default and will throw a clear configuration error rather than silently doing nothing. No OAuth client secrets or third-party credentials are bundled; wiring a real provider requires registering your own OAuth app and storing its credentials in the OS secret store (see `core/secrets.ts`).

## Voice output

`voice_speak` shells out to an OS-native text-to-speech binary (`say`, `espeak-ng`/`espeak`/`spd-say`, or PowerShell). No audio is recorded or sent anywhere; this is local, one-way text-to-speech only.

## Performance notes relevant to security

- The journal's in-memory tail cache (used by the dashboard and `GET /v1/journal`) never grows unbounded — it is capped and reflects only the same append-only, hash-chained data already on disk. It does not weaken the hash chain or the append-only guarantee.
- The memory index's incremental `sync()` still re-embeds and re-indexes any file whose modification time changed, so edited memories are never silently skipped; only unchanged files are skipped.

## Reporting

Do not include API keys, cookies, page content, or credentials in reports. Rotate any secret that may have been exposed.
