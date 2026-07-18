import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { createHash, randomUUID } from "node:crypto";

const parameters = Type.Object({
  text: Type.Optional(Type.String()),
  value: Type.Optional(Type.Any()),
  values: Type.Optional(Type.Array(Type.Any())),
  a: Type.Optional(Type.Number()),
  b: Type.Optional(Type.Number()),
  digits: Type.Optional(Type.Number()),
  pattern: Type.Optional(Type.String()),
  replacement: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  days: Type.Optional(Type.Number()),
  size: Type.Optional(Type.Number()),
});

type Params = {
  text?: string;
  value?: unknown;
  values?: unknown[];
  a?: number;
  b?: number;
  digits?: number;
  pattern?: string;
  replacement?: string;
  path?: string;
  days?: number;
  size?: number;
};
type Operation = {
  name: string;
  description: string;
  run: (p: Params) => unknown;
};

const text = (p: Params) => String(p.text ?? p.value ?? "");
const nums = (p: Params) =>
  (p.values ?? []).map(Number).filter(Number.isFinite);
const value = (p: Params) => p.value ?? p.values ?? p.text;
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/) : []);
const jsonPath = (input: unknown, path = "") =>
  path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      input,
    );
const date = (p: Params) =>
  new Date(String(p.text ?? p.value ?? new Date().toISOString()));
const dayMs = 86_400_000;

const operations: Operation[] = [
  {
    name: "text_uppercase",
    description: "Convert text to uppercase",
    run: (p) => text(p).toUpperCase(),
  },
  {
    name: "text_lowercase",
    description: "Convert text to lowercase",
    run: (p) => text(p).toLowerCase(),
  },
  {
    name: "text_title_case",
    description: "Convert text to title case",
    run: (p) =>
      text(p)
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
  },
  {
    name: "text_trim",
    description: "Trim surrounding whitespace",
    run: (p) => text(p).trim(),
  },
  {
    name: "text_slugify",
    description: "Create a URL-safe slug",
    run: (p) =>
      text(p)
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "-"),
  },
  {
    name: "text_word_count",
    description: "Count words",
    run: (p) => words(text(p)).length,
  },
  {
    name: "text_character_count",
    description: "Count Unicode characters",
    run: (p) => [...text(p)].length,
  },
  {
    name: "text_line_count",
    description: "Count lines",
    run: (p) => (text(p) ? text(p).split(/\r?\n/).length : 0),
  },
  {
    name: "text_reverse",
    description: "Reverse text",
    run: (p) => [...text(p)].reverse().join(""),
  },
  {
    name: "text_sort_lines",
    description: "Sort lines",
    run: (p) => text(p).split(/\r?\n/).sort().join("\n"),
  },
  {
    name: "text_unique_lines",
    description: "Remove duplicate lines",
    run: (p) => [...new Set(text(p).split(/\r?\n/))].join("\n"),
  },
  {
    name: "text_base64_encode",
    description: "Encode text as base64",
    run: (p) => Buffer.from(text(p)).toString("base64"),
  },
  {
    name: "text_base64_decode",
    description: "Decode base64 text",
    run: (p) => Buffer.from(text(p), "base64").toString("utf8"),
  },
  {
    name: "text_url_encode",
    description: "URL-encode text",
    run: (p) => encodeURIComponent(text(p)),
  },
  {
    name: "text_url_decode",
    description: "URL-decode text",
    run: (p) => decodeURIComponent(text(p)),
  },
  {
    name: "text_sha256",
    description: "Calculate a SHA-256 digest",
    run: (p) => createHash("sha256").update(text(p)).digest("hex"),
  },
  {
    name: "text_regex_test",
    description: "Test text against a regular expression",
    run: (p) => new RegExp(p.pattern ?? "").test(text(p)),
  },
  {
    name: "text_regex_replace",
    description: "Replace regular-expression matches",
    run: (p) =>
      text(p).replace(new RegExp(p.pattern ?? "", "g"), p.replacement ?? ""),
  },
  {
    name: "text_excerpt",
    description: "Create a bounded excerpt",
    run: (p) => text(p).slice(0, Math.max(0, p.size ?? 240)),
  },
  {
    name: "text_repeat",
    description: "Repeat text a bounded number of times",
    run: (p) => text(p).repeat(Math.min(100, Math.max(0, p.size ?? 1))),
  },

  {
    name: "math_add",
    description: "Add two numbers",
    run: (p) => (p.a ?? 0) + (p.b ?? 0),
  },
  {
    name: "math_subtract",
    description: "Subtract two numbers",
    run: (p) => (p.a ?? 0) - (p.b ?? 0),
  },
  {
    name: "math_multiply",
    description: "Multiply two numbers",
    run: (p) => (p.a ?? 0) * (p.b ?? 0),
  },
  {
    name: "math_divide",
    description: "Divide two numbers",
    run: (p) => {
      if (p.b === 0) throw new Error("Division by zero");
      return (p.a ?? 0) / (p.b ?? 1);
    },
  },
  {
    name: "math_modulo",
    description: "Calculate a modulo",
    run: (p) => (p.a ?? 0) % (p.b ?? 1),
  },
  {
    name: "math_power",
    description: "Raise a number to a power",
    run: (p) => Math.pow(p.a ?? 0, p.b ?? 1),
  },
  {
    name: "math_sqrt",
    description: "Calculate a square root",
    run: (p) => Math.sqrt(p.a ?? 0),
  },
  {
    name: "math_absolute",
    description: "Calculate absolute value",
    run: (p) => Math.abs(p.a ?? 0),
  },
  {
    name: "math_min",
    description: "Find the minimum",
    run: (p) => Math.min(...nums(p)),
  },
  {
    name: "math_max",
    description: "Find the maximum",
    run: (p) => Math.max(...nums(p)),
  },
  {
    name: "math_sum",
    description: "Sum numbers",
    run: (p) => nums(p).reduce((a, b) => a + b, 0),
  },
  {
    name: "math_mean",
    description: "Calculate arithmetic mean",
    run: (p) => {
      const n = nums(p);
      return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
    },
  },
  {
    name: "math_median",
    description: "Calculate median",
    run: (p) => {
      const n = nums(p).sort((a, b) => a - b);
      const m = Math.floor(n.length / 2);
      return n.length ? (n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2) : null;
    },
  },
  {
    name: "math_round",
    description: "Round a number",
    run: (p) =>
      Number((p.a ?? 0).toFixed(Math.min(12, Math.max(0, p.digits ?? 0)))),
  },
  {
    name: "math_clamp",
    description: "Clamp a to the range in values",
    run: (p) => {
      const [min = 0, max = 1] = nums(p);
      return Math.min(max, Math.max(min, p.a ?? 0));
    },
  },

  {
    name: "date_now_iso",
    description: "Get current time as ISO-8601",
    run: () => new Date().toISOString(),
  },
  {
    name: "date_unix_to_iso",
    description: "Convert Unix milliseconds to ISO",
    run: (p) => new Date(p.a ?? 0).toISOString(),
  },
  {
    name: "date_iso_to_unix",
    description: "Convert ISO time to Unix milliseconds",
    run: (p) => date(p).getTime(),
  },
  {
    name: "date_add_days",
    description: "Add days to a date",
    run: (p) =>
      new Date(date(p).getTime() + (p.days ?? 0) * dayMs).toISOString(),
  },
  {
    name: "date_diff_days",
    description: "Difference in days between two ISO dates",
    run: (p) =>
      (new Date(String(p.value)).getTime() - date(p).getTime()) / dayMs,
  },
  {
    name: "date_day_of_week",
    description: "Get weekday",
    run: (p) =>
      date(p).toLocaleDateString("en", { weekday: "long", timeZone: "UTC" }),
  },
  {
    name: "date_start_of_day",
    description: "Get UTC start of day",
    run: (p) => {
      const d = date(p);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    },
  },
  {
    name: "date_end_of_day",
    description: "Get UTC end of day",
    run: (p) => {
      const d = date(p);
      d.setUTCHours(23, 59, 59, 999);
      return d.toISOString();
    },
  },
  {
    name: "date_is_leap_year",
    description: "Check whether a year is leap",
    run: (p) => {
      const y = p.a ?? new Date().getUTCFullYear();
      return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    },
  },
  {
    name: "date_days_in_month",
    description: "Get days in month; a=year b=1-based month",
    run: (p) => new Date(Date.UTC(p.a ?? 1970, p.b ?? 1, 0)).getUTCDate(),
  },

  {
    name: "data_json_pretty",
    description: "Pretty-print JSON",
    run: (p) =>
      JSON.stringify(
        typeof p.value === "string" ? JSON.parse(p.value) : value(p),
        null,
        2,
      ),
  },
  {
    name: "data_json_minify",
    description: "Minify JSON",
    run: (p) =>
      JSON.stringify(
        typeof p.value === "string" ? JSON.parse(p.value) : value(p),
      ),
  },
  {
    name: "data_json_get",
    description: "Read a dot-separated JSON path",
    run: (p) => jsonPath(value(p), p.path),
  },
  {
    name: "data_json_keys",
    description: "List object keys",
    run: (p) => Object.keys((value(p) ?? {}) as object),
  },
  {
    name: "data_json_values",
    description: "List object values",
    run: (p) => Object.values((value(p) ?? {}) as object),
  },
  {
    name: "data_json_length",
    description: "Get array, object, or string length",
    run: (p) => {
      const v = value(p);
      return Array.isArray(v) || typeof v === "string"
        ? v.length
        : v && typeof v === "object"
          ? Object.keys(v).length
          : 0;
    },
  },
  {
    name: "data_json_merge",
    description: "Shallow-merge object values",
    run: (p) =>
      Object.assign(
        {},
        ...(p.values ?? []).filter((v) => v && typeof v === "object"),
      ),
  },
  {
    name: "data_sort_numbers",
    description: "Sort numeric values",
    run: (p) => nums(p).sort((a, b) => a - b),
  },
  {
    name: "data_unique_values",
    description: "Remove duplicate primitive values",
    run: (p) => [...new Set(p.values ?? [])],
  },
  {
    name: "data_chunk_array",
    description: "Split values into chunks",
    run: (p) => {
      const n = Math.max(1, p.size ?? 10);
      return (p.values ?? []).reduce<unknown[][]>((all, item, i) => {
        if (i % n === 0) all.push([]);
        all.at(-1)!.push(item);
        return all;
      }, []);
    },
  },
  {
    name: "data_flatten_array",
    description: "Flatten one array level",
    run: (p) => (p.values ?? []).flat(),
  },
  {
    name: "data_filter_truthy",
    description: "Keep truthy values",
    run: (p) => (p.values ?? []).filter(Boolean),
  },
  {
    name: "data_range",
    description: "Create a bounded numeric range from a to b",
    run: (p) => {
      const start = p.a ?? 0,
        end = p.b ?? 0,
        length = Math.min(1000, Math.max(0, Math.ceil(end - start)));
      return Array.from({ length }, (_, i) => start + i);
    },
  },
  {
    name: "data_random_uuid",
    description: "Generate a random UUID",
    run: () => randomUUID(),
  },
  {
    name: "data_parse_lines",
    description: "Parse non-empty lines as an array",
    run: (p) =>
      text(p)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
  },
];

function result(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function createUtilityTools(): AgentTool[] {
  return operations.map((operation) => ({
    name: operation.name,
    label: operation.name.replaceAll("_", " "),
    description: operation.description,
    parameters,
    execute: async (_id, params) => ({
      content: [
        { type: "text", text: result(operation.run(params as Params)) },
      ],
      details: {},
    }),
  }));
}

export const utilityToolCount = operations.length;
