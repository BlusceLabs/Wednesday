# Production deployment

1. Use a dedicated non-root OS account.
2. Install Bun, Python 3.11+, Chromium, Git, and an OS secret store.
3. Run `bun install` and `bun run setup:browser`.
4. Initialize configuration and store secrets with `bun run config`.
5. Run `bun run config -- validate` and fix any reported problems before starting the service.
6. Keep the gateway on `127.0.0.1`; publish through Tailscale or a TLS reverse proxy. The gateway rate-limits every `/v1/*` route (`server.rateLimit`, default 120 requests/minute) but that is not a substitute for keeping it off the public internet.
7. Restrict the configured workspace to a dedicated directory.
8. Back up the Markdown vault and verify the hash-chained journal; review it from the dashboard's Audit log panel or `GET /v1/journal`.
9. If you want Wednesday to follow you across machines, set `git.remote` and use the approval-gated `git_push`/`git_pull` tools, or run them yourself from the workspace.
10. Proactive scheduling (`scheduler.tasks`) only runs while the process is alive; for true background scheduling, register an OS cron / launchd / Task Scheduler entry that runs `bun run headless "prompt"` on your desired cadence.
11. Startup is parallelized (vault, memory index, journal, session store, and git history all initialize concurrently) and the memory index only re-embeds changed vault files, so restarts stay fast even as the vault grows — no extra configuration needed.
12. Run `bun run doctor`, tests, and TypeScript checks before each deploy.
13. Configure process supervision with graceful SIGTERM and restart-on-failure.
14. Review every approval request; never approve an action you do not understand.

Do not run the production agent as root or expose port 4317 directly to the public internet.
