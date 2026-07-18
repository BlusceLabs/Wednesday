/**
 * A minimal single-flight promise queue: tasks submitted via `run` execute
 * strictly one at a time, in submission order, even if several are fired
 * concurrently. The next task waits for the previous one to settle before
 * starting.
 *
 * This is what keeps Wednesday's agent single-threaded across all its
 * entry points (TUI, headless, HTTP API, proactive scheduler) — concurrent
 * `submit()`s would otherwise interleave on the shared `agent.state.messages`
 * array. It is extracted into its own module so the ordering/fault-isolation
 * guarantees can be unit-tested without booting the whole runtime.
 */
export interface SerialQueue {
  /** Queue `task`; resolve/reject with its outcome. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      // `task` is used as both the fulfill and reject handler so a rejected
      // predecessor still lets the next task run (instead of short-circuiting
      // the chain with the prior rejection).
      const next = chain.then(task, task);
      // Swallow the outcome on the internal chain so a rejected task can't
      // surface as an unhandled rejection or wedge later tasks.
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
