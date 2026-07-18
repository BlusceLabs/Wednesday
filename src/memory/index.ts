import { Database } from "bun:sqlite";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  decodeVector,
  type Embedder,
  encodeVector,
  hashEmbedder,
} from "./embeddings";

export interface MemoryHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface StaleMemory {
  path: string;
  title: string;
  modified: string;
  ageDays: number;
}

function titleOf(markdown: string, fallback: string) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;
}

function ftsQuery(input: string) {
  return input
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(" OR ");
}

export class MemoryIndex {
  private db: Database;

  constructor(
    path: string,
    private readonly embeddingsEnabled: boolean = true,
    private readonly embedder: Embedder = hashEmbedder,
  ) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        modified_ms INTEGER NOT NULL,
        embedding TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        path UNINDEXED, title, body, tokenize='unicode61', prefix='2 3'
      );
    `);
    try {
      this.db.exec("ALTER TABLE documents ADD COLUMN embedding TEXT;");
    } catch {}
  }

  static async create(
    path: string,
    embeddingsEnabled = true,
    embedder: Embedder = hashEmbedder,
  ) {
    await mkdir(dirname(path), { recursive: true });
    return new MemoryIndex(path, embeddingsEnabled, embedder);
  }

  async rebuild(vaultRoot: string) {
    this.db.exec("DELETE FROM documents; DELETE FROM documents_fts;");
    for (const path of await this.markdownFiles(vaultRoot)) {
      const body = await readFile(path, "utf8");
      const info = await stat(path);
      const relativePath = relative(vaultRoot, path);
      const title = titleOf(body, relativePath);
      const embedding = encodeVector(this.embedder.embed(`${title}\n${body}`));
      this.db
        .query(
          "INSERT INTO documents(path,title,body,modified_ms,embedding) VALUES(?,?,?,?,?)",
        )
        .run(relativePath, title, body, info.mtimeMs, embedding);
      this.db
        .query("INSERT INTO documents_fts(path,title,body) VALUES(?,?,?)")
        .run(relativePath, title, body);
    }
  }

  /**
   * Incremental alternative to rebuild(): only re-reads, re-embeds, and
   * re-indexes vault files that are new or whose mtime changed since the
   * last sync/rebuild, and removes rows for files that no longer exist.
   * `rebuild()` re-embeds and re-inserts every single vault file on every
   * call, which made every startup and every auto-summarization pay for
   * the full vault size; `sync()` makes those paths proportional to the
   * number of *changed* files instead, which is normally zero or small.
   * `/reindex` still calls the full `rebuild()` when a deliberate full
   * rebuild is wanted (e.g. after manually editing vault files or schema
   * doubts).
   */
  async sync(vaultRoot: string) {
    const known = new Map(
      this.db
        .query<{ path: string; modified_ms: number }, []>(
          "SELECT path, modified_ms FROM documents",
        )
        .all()
        .map((row) => [row.path, row.modified_ms] as const),
    );
    const seen = new Set<string>();
    for (const path of await this.markdownFiles(vaultRoot)) {
      const relativePath = relative(vaultRoot, path);
      seen.add(relativePath);
      const info = await stat(path);
      if (known.get(relativePath) === info.mtimeMs) continue;
      const body = await readFile(path, "utf8");
      const title = titleOf(body, relativePath);
      const embedding = encodeVector(this.embedder.embed(`${title}\n${body}`));
      this.db
        .query(
          `INSERT INTO documents(path,title,body,modified_ms,embedding) VALUES(?,?,?,?,?)
           ON CONFLICT(path) DO UPDATE SET
             title = excluded.title,
             body = excluded.body,
             modified_ms = excluded.modified_ms,
             embedding = excluded.embedding`,
        )
        .run(relativePath, title, body, info.mtimeMs, embedding);
      this.db
        .query("DELETE FROM documents_fts WHERE path = ?")
        .run(relativePath);
      this.db
        .query("INSERT INTO documents_fts(path,title,body) VALUES(?,?,?)")
        .run(relativePath, title, body);
    }
    for (const path of known.keys()) {
      if (seen.has(path)) continue;
      this.db.query("DELETE FROM documents WHERE path = ?").run(path);
      this.db.query("DELETE FROM documents_fts WHERE path = ?").run(path);
    }
  }

  search(query: string, limit = 6): MemoryHit[] {
    const match = ftsQuery(query);
    const keywordHits = match
      ? this.db
          .query<MemoryHit, [string, number]>(
            `
      SELECT path, title,
        snippet(documents_fts, 2, '[', ']', ' … ', 24) AS snippet,
        bm25(documents_fts, 0.0, 4.0, 1.0) AS score
      FROM documents_fts
      WHERE documents_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `,
          )
          .all(match, limit)
      : [];
    if (!this.embeddingsEnabled || keywordHits.length >= limit)
      return keywordHits;
    const seen = new Set(keywordHits.map((hit) => hit.path));
    const semanticHits = this.semanticSearch(query, limit).filter(
      (hit) => !seen.has(hit.path),
    );
    return [...keywordHits, ...semanticHits].slice(0, limit);
  }

  /**
   * Ranks every memory by cosine similarity against a lightweight local
   * hashed embedding of the query (see memory/embeddings.ts). This is an
   * additive, optional layer on top of keyword FTS5 search — useful for
   * paraphrased or synonym-heavy recall that keyword matching misses.
   */
  semanticSearch(query: string, limit = 6): MemoryHit[] {
    const queryVector = this.embedder.embed(query);
    const match = ftsQuery(query);
    // Restrict the cosine scan to a bounded set of FTS candidate rows
    // instead of the entire table — `search()` runs on every chat turn, so a
    // full-table scan per query scales poorly as the vault grows. We keep
    // recall high by scoring the top-250 keyword candidates; if there are no
    // candidates (or no query) we fall back to scoring everything.
    let rows: Array<{
      path: string;
      title: string;
      body: string;
      embedding: string | null;
    }>;
    if (match) {
      const candidates = this.db
        .query<{ path: string }, [string]>(
          `SELECT path FROM documents_fts WHERE documents_fts MATCH ? ORDER BY bm25(documents_fts) LIMIT 250`,
        )
        .all(match)
        .map((r) => r.path);
      if (candidates.length) {
        const placeholders = candidates.map(() => "?").join(",");
        rows = this.db
          .query<
            {
              path: string;
              title: string;
              body: string;
              embedding: string | null;
            },
            string[]
          >(
            `SELECT path, title, body, embedding FROM documents WHERE path IN (${placeholders})`,
          )
          .all(...candidates);
      } else {
        rows = [];
      }
    } else {
      rows = this.db
        .query<
          {
            path: string;
            title: string;
            body: string;
            embedding: string | null;
          },
          []
        >("SELECT path, title, body, embedding FROM documents")
        .all();
    }
    return rows
      .filter((row) => row.embedding)
      .map((row) => ({
        path: row.path,
        title: row.title,
        snippet: row.body.slice(0, 160).replace(/\s+/g, " ").trim(),
        score: this.embedder.similarity(queryVector, decodeVector(row.embedding!)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Lists memories that have not been touched (created or updated) in over
   * `days` days, oldest first — a lightweight staleness/review workflow so
   * outdated or conflicting memories can surface for human review instead
   * of silently rotting in the vault.
   */
  stale(days: number, limit = 20): StaleMemory[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.db
      .query<
        { path: string; title: string; modified_ms: number },
        [number, number]
      >(
        "SELECT path, title, modified_ms FROM documents WHERE modified_ms < ? ORDER BY modified_ms ASC LIMIT ?",
      )
      .all(cutoff, limit)
      .map((row) => ({
        path: row.path,
        title: row.title,
        modified: new Date(row.modified_ms).toISOString(),
        ageDays: Math.floor((Date.now() - row.modified_ms) / 86_400_000),
      }));
  }

  private async markdownFiles(root: string): Promise<string[]> {
    const output: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) output.push(...(await this.markdownFiles(path)));
      else if (entry.isFile() && entry.name.endsWith(".md")) output.push(path);
    }
    return output;
  }

  close() {
    this.db.close();
  }
}
