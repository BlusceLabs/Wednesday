import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JournalInput {
  type: string;
  actor: "user" | "wednesday" | "system" | "tool";
  sessionId?: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}

export interface JournalEvent extends JournalInput {
  id: string;
  timestamp: string;
  previousHash: string | null;
  hash: string;
}

// Bounds the in-memory tail cache. This matches the maximum `limit` the
// HTTP `/v1/journal` route accepts (clamped to 500 in server/app.ts), so
// the cache alone can always satisfy that API and the dashboard's polling
// without touching disk.
const CACHE_SIZE = 500;

export class EventJournal {
  private previousHash: string | null = null;
  // Serializes `append()` calls so concurrent writers (e.g. the
  // `prompt.accepted` audit entry fired in the background, overlapping the
  // model call, plus tool-event appends that happen during a turn) can't
  // interleave their `previousHash` read/update and fork the hash chain.
  // Each append runs only after the prior one has settled.
  private writeChain: Promise<unknown> = Promise.resolve();
  // Newest-last ring buffer mirroring the tail of the on-disk journal, kept
  // in memory so repeated tail() calls (e.g. dashboard polling every few
  // seconds) don't re-read and re-parse the whole append-only file, which
  // otherwise grows without bound and made every poll slower over time.
  private cache: JournalEvent[] = [];

  constructor(private readonly path: string) {}

  async initialize() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const lines = (await readFile(this.path, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean);
      const tail = lines.slice(-CACHE_SIZE);
      this.cache = tail
        .map((line) => {
          try {
            return JSON.parse(line) as JournalEvent;
          } catch {
            return null;
          }
        })
        .filter((event): event is JournalEvent => event !== null);
      // Re-establish the hash-chain anchor from the last *valid* event
      // rather than blindly the final line. A single corrupt trailing entry
      // previously reset previousHash to null (via the outer catch), which
      // broke audit-chain continuity for the rest of the file.
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]) as Partial<JournalEvent>;
          if (parsed && typeof parsed.hash === "string") {
            this.previousHash = parsed.hash;
            break;
          }
        } catch {}
      }
    } catch {}
  }

  async append(input: JournalInput) {
    const run = async (): Promise<JournalEvent> => {
      const unsigned = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        ...input,
        previousHash: this.previousHash,
      };
      const hash = createHash("sha256")
        .update(JSON.stringify(unsigned))
        .digest("hex");
      const event = { ...unsigned, hash };
      await appendFile(this.path, JSON.stringify(event) + "\n", "utf8");
      this.previousHash = hash;
      this.cache.push(event);
      if (this.cache.length > CACHE_SIZE) this.cache.shift();
      return event;
    };
    // Enqueue on the serialized chain. Using `run` for both fulfillment
    // and rejection keeps the chain alive even if an append throws (a
    // rejected link would otherwise poison every later append).
    const next = this.writeChain.then(run, run);
    this.writeChain = next.then(() => {}, () => {});
    return next;
  }

  /**
   * Returns the most recent journal events, newest first. Backs the
   * dashboard audit log viewer and the `/v1/journal` API. Served entirely
   * from the in-memory cache populated by `initialize()`/`append()` — no
   * disk read on the hot path, since callers may poll this frequently.
   */
  tail(limit = 50, filter?: { type?: string; actor?: string }): JournalEvent[] {
    const filtered = filter
      ? this.cache.filter(
          (event) =>
            (!filter.type || event.type === filter.type) &&
            (!filter.actor || event.actor === filter.actor),
        )
      : this.cache;
    return filtered.slice(-limit).reverse();
  }

  /**
   * Verify the on-disk journal's hash chain end-to-end. Each event's stored
   * `hash` must equal `sha256` of the event with its own `hash` removed and
   * the preceding event's `hash` as `previousHash`. Returns whether the
   * chain is intact and, if not, the 1-based line of the first bad entry.
   * The chain is built on every `append()` but never checked until now — this
   * is what makes the audit log actually tamper-evident.
   */
  async verify(): Promise<{
    ok: boolean;
    entries: number;
    firstBad?: number;
  }> {
    try {
      const lines = (await readFile(this.path, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean);
      let previousHash: string | null = null;
      for (let i = 0; i < lines.length; i++) {
        const parsed = JSON.parse(lines[i]) as JournalEvent;
        const unsigned: Omit<JournalEvent, "hash"> & { hash: undefined } = {
          ...parsed,
          hash: undefined,
          previousHash,
        };
        const hash = createHash("sha256")
          .update(JSON.stringify(unsigned))
          .digest("hex");
        if (hash !== parsed.hash)
          return { ok: false, entries: lines.length, firstBad: i + 1 };
        previousHash = parsed.hash;
      }
      return { ok: true, entries: lines.length };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
        return { ok: true, entries: 0 };
      return { ok: false, entries: 0, firstBad: 0 };
    }
  }
}
