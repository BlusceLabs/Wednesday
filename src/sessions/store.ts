import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface StoredSession {
  version: 1;
  updatedAt: string;
  messages: AgentMessage[];
}

export class SessionStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AgentMessage[]> {
    try {
      const stored = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as StoredSession;
      return stored.version === 1 && Array.isArray(stored.messages)
        ? stored.messages
        : [];
    } catch {
      return [];
    }
  }

  async save(messages: AgentMessage[]) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    const stored: StoredSession = {
      version: 1,
      updatedAt: new Date().toISOString(),
      messages,
    };
    await writeFile(temporary, JSON.stringify(stored, null, 2), "utf8");
    await rename(temporary, this.path);
  }

  async clear() {
    await rm(this.path, { force: true });
  }

  async info() {
    try {
      const file = await stat(this.path);
      const messages = await this.load();
      return {
        path: this.path,
        messages: messages.length,
        updatedAt: file.mtime.toISOString(),
      };
    } catch {
      return { path: this.path, messages: 0, updatedAt: null };
    }
  }
}

interface ChatMessage {
  role?: unknown;
  content?: unknown;
}

function partToText(part: unknown): string {
  return typeof part === "object" && part !== null && "text" in part
    ? String((part as { text?: unknown }).text ?? "")
    : "";
}

function excerptText(message: AgentMessage): string {
  const { role, content } = message as ChatMessage;
  const text = Array.isArray(content)
    ? content.map(partToText).join(" ")
    : typeof content === "string"
      ? content
      : "";
  const trimmed = text.trim();
  return trimmed ? `${String(role ?? "message")}: ${trimmed}` : "";
}

export interface SummarizeResult {
  summary: string;
  trimmed: AgentMessage[];
  droppedCount: number;
}

/**
 * Cross-session memory summarization: once a conversation grows past
 * `keepRecent` messages, condense everything older into a short excerpt and
 * drop it from the live message array. The caller is expected to persist
 * the excerpt as a durable memory (see WednesdayRuntime.maybeSummarize) so
 * older context is never silently lost — it is written to the vault
 * instead of being kept verbatim in every future request.
 */
export function summarizeOlderMessages(
  messages: AgentMessage[],
  keepRecent: number,
): SummarizeResult {
  if (messages.length <= keepRecent)
    return { summary: "", trimmed: messages, droppedCount: 0 };
  const older = messages.slice(0, messages.length - keepRecent);
  const trimmed = messages.slice(messages.length - keepRecent);
  const summary = older
    .map(excerptText)
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
  return { summary, trimmed, droppedCount: older.length };
}
