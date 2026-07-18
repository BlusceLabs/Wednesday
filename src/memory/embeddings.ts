const DIMENSIONS = 128;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic, dependency-free "embedding": a hashed bag-of-words vector.
 * This is not a trained semantic model — it is a lightweight, fully local
 * approximation of semantic similarity (paraphrases and shared vocabulary
 * score higher than unrelated text) that needs no network access and no
 * model download, matching Wednesday's local-first, offline-friendly
 * design. Treat memory.embeddingsEnabled as an optional additive layer on
 * top of the primary SQLite FTS5 keyword search, not a replacement for it.
 *
 * Limitation: with only 128 FNV-hashed buckets, distinct tokens collide
 * often, so "semantic" recall is effectively lexical-overlap recall. The
 * interface (embed/cosineSimilarity) is intentionally stable, so this can
 * later be swapped for a small local ONNX embedder behind the same
 * `embeddingsEnabled` flag without touching callers.
 */
export function embed(text: string): Float64Array {
  const vector = new Float64Array(DIMENSIONS);
  for (const token of tokenize(text)) {
    const bucket = hashToken(token) % DIMENSIONS;
    const sign = hashToken(`${token}#sign`) % 2 === 0 ? 1 : -1;
    vector[bucket] += sign;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) dot += a[i] * b[i];
  return dot;
}

export function encodeVector(vector: Float64Array): string {
  return JSON.stringify(Array.from(vector));
}

export function decodeVector(text: string): Float64Array {
  return Float64Array.from(JSON.parse(text) as number[]);
}

export const EMBEDDING_DIMENSIONS = DIMENSIONS;

/**
 * A swappable text-embedding strategy. Keeping this behind an interface
 * means the memory index doesn't care how vectors are produced, so the
 * weak hashed bag-of-words default can later be replaced by a real local
 * embedder without touching `MemoryIndex` or any caller.
 */
export interface Embedder {
  /** Produce a fixed-dimensional vector for `text`. */
  embed(text: string): Float64Array;
  /** Cosine similarity in [−1, 1] between two vectors. */
  similarity(a: Float64Array, b: Float64Array): number;
}

/** The default embedder: the dependency-free hashed bag-of-words vector. */
export const hashEmbedder: Embedder = {
  embed: (text) => embed(text),
  similarity: (a, b) => cosineSimilarity(a, b),
};

export type EmbedderKind = "hash" | "onnx";

/**
 * Select an embedder implementation. Only the local hashed embedder ships
 * today; `"onnx"` is the extension point for a small local model (e.g. a
 * quantized ONNX embedder) that would give genuine paraphrase recall. That
 * path needs a model file plus an ONNX runtime dependency and is
 * intentionally left as a documented stub so the interface stays stable and
 * swappable without changing callers.
 */
export function createEmbedder(kind: EmbedderKind = "hash"): Embedder {
  switch (kind) {
    case "hash":
      return hashEmbedder;
    case "onnx":
      throw new Error(
        "ONNX embedding is not bundled. Provide a model file and an ONNX " +
          "runtime, then implement createEmbedder's 'onnx' branch.",
      );
    default:
      return hashEmbedder;
  }
}
