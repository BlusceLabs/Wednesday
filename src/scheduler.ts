import type { WednesdayRuntime } from "./agent/runtime";
import type { SchedulerConfig } from "./core/config";
import type { EventJournal } from "./core/journal";

/**
 * Runs configured proactive check-in tasks on a fixed interval while the
 * current process (terminal UI or `bun run serve`) stays alive.
 *
 * Limitation: this is not a background daemon. If Wednesday isn't running,
 * scheduled tasks do not fire. For true background scheduling — e.g. a
 * morning briefing even when the terminal UI is closed — register an
 * OS-level cron job / launchd agent / Task Scheduler entry that runs
 * `bun run headless "your prompt"` on the desired cadence instead.
 */
export class TaskScheduler {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly config: SchedulerConfig,
    private readonly runtime: WednesdayRuntime,
    private readonly journal: EventJournal,
  ) {}

  start() {
    if (!this.config.enabled || this.config.tasks.length === 0) return;
    for (const task of this.config.tasks) {
      const intervalMs = Math.max(1, task.intervalMinutes) * 60_000;
      const timer = setInterval(() => {
        void this.journal
          .append({
            type: "scheduler.fired",
            actor: "system",
            payload: { taskId: task.id, name: task.name },
          })
          .then(() => this.runtime.submit(task.prompt))
          .catch(() => {});
      }, intervalMs);
      this.timers.push(timer);
    }
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}
