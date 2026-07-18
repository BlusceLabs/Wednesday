import { useEffect, useMemo, useRef, useState } from "react";
import {
  useKeyboard,
  useRenderer,
  usePaste,
  useFocus,
  useBlur,
  useSelectionHandler,
  useOnResize,
  useTerminalDimensions,
  useTimeline,
} from "@opentui/react";
import {
  type PasteEvent,
  type ScrollBoxRenderable,
  type SelectOption,
  type TabSelectRenderable,
  type TextareaRenderable,
  SyntaxStyle,
  decodePasteBytes,
} from "@opentui/core";
import { homedir } from "node:os";
import type { WednesdayRuntime } from "../agent/runtime";

// Compact a string to `size` chars with a trailing ellipsis when longer.
function truncate(text: string, size: number) {
  return text.length > size ? `${text.slice(0, size)}…` : text;
}

interface Message {
  role: "you" | "wednesday" | "system";
  text: string;
  thinking?: string;
  // Whether the thinking block is expanded. Set true while its turn is
  // streaming, then auto-collapsed on completion; the global toggle
  // (Ctrl+T) reveals every message's thinking at once.
  thinkingOpen?: boolean;
  // Wednesday answers are rendered with the markdown component. While the
  // turn is streaming we pass `streaming` so the markdown renderer does
  // incremental, syntax-highlighted updates instead of rebuilding each tick.
  streaming?: boolean;
  // Optional ASCII-art banner shown in place of the role label (used for the
  // welcome greeting).
  banner?: string;
}

type Tab = "chat" | "tools" | "memories" | "about";

const TABS: { name: string; description: string; value: Tab }[] = [
  { name: "Chat", description: "Conversation", value: "chat" },
  { name: "Tools", description: "Command palette", value: "tools" },
  { name: "Memories", description: "Recalled vault", value: "memories" },
  { name: "About", description: "Info & keys", value: "about" },
];

// Slash commands surfaced in the Tools tab as a runnable palette.
const LOCAL_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "/help", desc: "Show local commands" },
  { cmd: "/model", desc: "Show the active model" },
  { cmd: "/models", desc: "List available models" },
  { cmd: "/effort", desc: "Show or set reasoning effort" },
  { cmd: "/remember", desc: "Save a durable memory" },
  { cmd: "/recall", desc: "Search the vault (keyword + semantic)" },
  { cmd: "/stale", desc: "List memories not touched recently" },
  { cmd: "/forget", desc: "Delete a memory by title" },
  { cmd: "/export", desc: "Back up the whole memory vault" },
  { cmd: "/import", desc: "Restore memories from a backup" },
  { cmd: "/stats", desc: "Show vault size and breakdown" },
  { cmd: "/tags", desc: "List tags used across memories" },
  { cmd: "/reindex", desc: "Rebuild the memory index" },
  { cmd: "/session", desc: "Show persistent-session information" },
  { cmd: "/history", desc: "Show recent memory commits" },
  { cmd: "/clear", desc: "Clear the current conversation" },
];

const COLORS = {
  // charcoal black
  bg: "#1E1E1E",
  border: "#333333",
  // jungle green
  wednesday: "#3FA34D",
  // mustard yellow
  you: "#E0A526",
  thinking: "#E0A526",
  // cactus grey
  system: "#8B9A8A",
  muted: "#9AA39A",
  chip: "#8B9A8A",
  // harmonious muted red for errors (outside the core palette)
  error: "#D9625B",
};

// Design system — shared rhythm so every surface feels like one app.
const SP = { xs: 1, sm: 2, md: 3, lg: 4 } as const;
const SEP = "·"; // middot used as a soft separator in status lines
const HINT = COLORS.muted;

// Thin horizontal rule used to separate sections (1 cell tall, border color).
function Divider() {
  return <box style={{ height: 1, backgroundColor: COLORS.border }} />;
}

// A small uppercase eyebrow used as a panel/section header.
function SectionHeader({ label, right }: { label: string; right?: string }) {
  return (
    <box
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingLeft: SP.sm,
        paddingRight: SP.sm,
      }}
    >
      <text fg={COLORS.you}>
        <b>{label}</b>
      </text>
      {right ? <text fg={HINT}>{right}</text> : null}
    </box>
  );
}

// Status pill in the header: colored dot + label, color-coded by state.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Self-animating glyph; advances through the frame list on its own timeline so
// only this tiny node re-renders (not the whole tree).
function Spinner({ color }: { color: string }) {
  const [frame, setFrame] = useState(0);
  const timeline = useTimeline({ duration: 800, loop: true });
  useEffect(() => {
    const start = Date.now();
    timeline.add(
      { f: 0 },
      {
        f: SPINNER_FRAMES.length,
        duration: 800,
        ease: "linear",
        onUpdate: (a: { targets: { f: number }[] }) =>
          setFrame(Math.floor(a.targets[0].f) % SPINNER_FRAMES.length),
      },
    );
    void start;
  }, [timeline]);
  useEffect(() => {
    timeline.play();
  }, [timeline]);
  return <text fg={color}>{SPINNER_FRAMES[frame]}</text>;
}

function StatusPill({ status }: { status: "ready" | "thinking" | "error" }) {
  const color =
    status === "error" ? COLORS.error : status === "thinking" ? COLORS.thinking : COLORS.wednesday;
  const label = status === "thinking" ? "thinking" : status === "error" ? "error" : "ready";
  return (
    <box style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
      {status === "thinking" ? (
        <Spinner color={color} />
      ) : (
        <text fg={color}>●</text>
      )}
      <text fg={color}>
        <b>{label}</b>
      </text>
    </box>
  );
}

// ASCII-art welcome banner (verbatim; String.raw keeps the backslashes literal).
const WEDNESDAY_BANNER = String.raw`__      __           .___                       .___
/  \    /  \ ____   __| _/____   ____   ______ __| _/____  ___.__.
\   \/\/   // __ \ / __ |/    \_/ __ \ /  ___// __ |\__  \<   |  |
 \        /\  ___// /_/ |   |  \  ___/ \___ \/ /_/ | / __ \___  |
  \__/\  /  \___  >____ |___|  /\___  >____  >____ |(____  / ____|
       \/       \/     \/    \/     \/     \/     \/\/      `;

// Compact token counts: 141000 -> "141k", 3800000 -> "3.8M".
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ~/Downloads/... instead of /home/you/Downloads/...
function shortPath(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

// Map a file path to a tree-sitter/highlighter filetype.
function filetypeOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    html: "html",
    css: "css",
    rs: "rust",
    go: "go",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    java: "java",
    rb: "ruby",
    sql: "sql",
  };
  return map[ext] ?? "text";
}

// Animated indeterminate progress bar shown in the header while Wednesday
// is thinking. Driven entirely by OpenTUI's useTimeline animation hook so
// the indicator re-renders on its own without re-rendering the whole tree.
function ThinkingBar({ active }: { active: boolean }) {
  const [pct, setPct] = useState(0);
  const timeline = useTimeline({ duration: 1100, loop: true });
  useEffect(() => {
    timeline.add(
      { pct: 0 },
      {
        pct: 1,
        duration: 1100,
        ease: "linear",
        onUpdate: (a: { targets: { pct: number }[] }) =>
          setPct(a.targets[0].pct),
      },
    );
  }, [timeline]);
  useEffect(() => {
    if (active) {
      setPct(0);
      timeline.play();
    } else {
      timeline.pause();
      setPct(0);
    }
  }, [active, timeline]);
  if (!active) return null;
  const SEGMENTS = 14;
  const filled = Math.round(pct * SEGMENTS);
  const bar = "█".repeat(filled) + "░".repeat(SEGMENTS - filled);
  return <text fg={COLORS.thinking}>{bar}</text>;
}

export function App({ runtime }: { runtime: WednesdayRuntime }) {
  const renderer = useRenderer();
  const dims = useTerminalDimensions();

  const statusRef = useRef<"ready" | "thinking" | "error">("ready");
  const streamingRef = useRef(false);
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const tabRef = useRef<TabSelectRenderable | null>(null);
  // Chat transcript scrollbox — used to drive auto-scroll + the "new
  // messages" hint and to jump back to the latest line on demand.
  const chatScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "wednesday",
      banner: WEDNESDAY_BANNER,
      text: "",
    },
  ]);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [status, setStatus] = useState<"ready" | "thinking" | "error">("ready");
  const [showThinking, setShowThinking] = useState(false);
  const [stats, setStats] = useState(() => runtime.stats());

  // /models popup selector: mirrors opencode's model picker — a centered
  // dialog with a search input, grouped (by provider) model list, the
  // current model marked, and arrow/enter/esc navigation handled globally.
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelSelected, setModelSelected] = useState(0);
  const modelScrollRef = useRef<ScrollBoxRenderable | null>(null);
  // Per-provider auth readiness (pi-ai `checkAuth`) and the set of models
  // usable right now (pi-ai `getAvailable`), fetched when the picker opens.
  const [modelAuth, setModelAuth] = useState<Record<string, { source?: string; type?: string } | null>>({});
  const [modelReady, setModelReady] = useState<Set<string>>(new Set());
  // opencode-style inline key prompt: when a model is selected whose
  // provider has no key configured, we ask for the API key (and optional
  // base URL) instead of switching. `pending` holds the model to select once
  // the key is stored.
  const [keyPrompt, setKeyPrompt] = useState<{
    provider: string;
    baseUrl: string;
    pending: { provider: string; id: string; name: string };
  } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const keyInputRef = useRef<{ setText: (s: string) => void } | null>(null);

  const allModels = useMemo(() => runtime.listModels(), [runtime]);

  // Flat, filtered, selectable list (search across provider + model name),
  // plus the grouped view used for rendering section headers.
  const modelFlat = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return allModels
      .filter((m) => {
        if (!q) return true;
        return `${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(q);
      })
      .sort((a, b) =>
        a.provider === b.provider
          ? a.id.localeCompare(b.id)
          : a.provider.localeCompare(b.provider),
      );
  }, [allModels, modelQuery]);

  const modelGroups = useMemo(() => {
    const groups: { provider: string; items: typeof modelFlat }[] = [];
    for (const m of modelFlat) {
      let g = groups.find((x) => x.provider === m.provider);
      if (!g) {
        g = { provider: m.provider, items: [] };
        groups.push(g);
      }
      g.items.push(m);
    }
    return groups.sort((a, b) => a.provider.localeCompare(b.provider));
  }, [modelFlat]);

  // Keep the selection index within bounds as the filtered list changes.
  useEffect(() => {
    setModelSelected((prev) =>
      modelFlat.length === 0 ? 0 : Math.min(prev, modelFlat.length - 1),
    );
  }, [modelFlat.length]);

  // When the picker opens, highlight the currently active model and pull
  // pi-ai auth + availability info for every provider in the catalog.
  useEffect(() => {
    if (!modelPickerOpen) return;
    const idx = modelFlat.findIndex((m) => m.active);
    setModelSelected(idx >= 0 ? idx : 0);
    const providers = [...new Set(allModels.map((m) => m.provider))];
    void (async () => {
      const auth: Record<string, { source?: string; type?: string } | null> = {};
      await Promise.all(
        providers.map(async (p) => {
          const info = await runtime.authInfoFor(p);
          auth[p] = info ?? null;
        }),
      );
      setModelAuth(auth);
      setModelReady(await runtime.availableModelIds());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPickerOpen]);

  // Keep the highlighted row scrolled into view as the selection or the
  // filtered list changes (mirrors opencode's auto-scroll behavior).
  useEffect(() => {
    if (!modelPickerOpen) return;
    const m = modelFlat[modelSelected];
    if (m) modelScrollRef.current?.scrollChildIntoView(`model:${m.provider}/${m.id}`);
  }, [modelPickerOpen, modelSelected, modelFlat]);

  // Panel navigation + browser/tab focus + paste/selection feedback.
  const [tab, setTab] = useState<Tab>("chat");
  const [windowFocused, setWindowFocused] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Whether the Chat transcript is scrolled away from the latest message
  // (paused auto-scroll). Drives the "new messages below" footer hint.
  const [followHint, setFollowHint] = useState(false);
  const flashToast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  // Recalled vault memory titles harvested from /recall and /stale notices.
  const [recalled, setRecalled] = useState<string[]>([]);
  const [memoryFilter, setMemoryFilter] = useState("");

  // Tools tab: filter text + selected-option detail.
  const [toolFilter, setToolFilter] = useState("");
  const [toolDetail, setToolDetail] = useState<string>("");

  // One syntax style shared by every code/markdown/diff viewer.
  const syntax = useMemo(() => SyntaxStyle.create(), []);
  useEffect(() => () => syntax.destroy(), [syntax]);

  const toolCatalog = useMemo(() => runtime.toolsInfo().tools, [runtime]);
  const toolOptions = useMemo<SelectOption[]>(() => {
    const f = toolFilter.trim().toLowerCase();
    const tools: SelectOption[] = toolCatalog.map((t) => ({
      name: t.name,
      description: `${t.group ?? t.category} · ${t.label}`,
      value: { runnable: false, raw: t.name },
    }));
    const cmds: SelectOption[] = LOCAL_COMMANDS.map((c) => ({
      name: c.cmd,
      description: c.desc,
      value: { runnable: true, raw: c.cmd },
    }));
    const all = [...cmds, ...tools];
    if (!f) return all;
    return all.filter(
      (o) =>
        o.name.toLowerCase().includes(f) ||
        (o.description ?? "").toLowerCase().includes(f),
    );
  }, [toolCatalog, toolFilter]);

  useEffect(
    () =>
      runtime.events.subscribe((event) => {
        if (event.type === "status") {
          statusRef.current = event.value;
          setStatus(event.value);
          if (event.value === "thinking") streamingRef.current = false;
        }
        if (event.type === "thinking.delta") {
          setMessages((current) => {
            const next = current.map((m) => ({ ...m }));
            const last = next.at(-1);
            if (streamingRef.current && last?.role === "wednesday") {
              last.thinking = (last.thinking ?? "") + event.delta;
              last.thinkingOpen = true;
            } else {
              next.push({
                role: "wednesday",
                text: "",
                thinking: event.delta,
                thinkingOpen: true,
              });
              streamingRef.current = true;
            }
            return next;
          });
        }
        if (event.type === "assistant.delta") {
          setMessages((current) => {
            const next = current.map((m) => ({ ...m }));
            const last = next.at(-1);
            if (streamingRef.current && last?.role === "wednesday") {
              last.text += event.delta;
              last.streaming = true;
            } else {
              next.push({ role: "wednesday", text: event.delta, streaming: true });
              streamingRef.current = true;
            }
            return next;
          });
        }
        if (event.type === "notice") {
          streamingRef.current = false;
          setMessages((current) => [
            ...current,
            { role: "system", text: event.message },
          ]);
          // Harvest recalled memory titles for the Memories panel.
          const titles = event.message
            .split("\n")
            .map((l) => l.match(/^•\s+(.+?)\s+—/)?.[1])
            .filter(Boolean) as string[];
          if (titles.length)
            setRecalled((r) => Array.from(new Set([...r, ...titles])));
        }
        if (event.type === "model.changed") {
          streamingRef.current = false;
          setStats(runtime.stats());
        }
        if (event.type === "assistant.done") {
          streamingRef.current = false;
          setStats(runtime.stats());
          // Finalize markdown streaming and auto-collapse the just-finished
          // turn's thinking so the chat stays focused on the answer.
          setMessages((current) =>
            current.map((m) =>
              m.role === "wednesday"
                ? { ...m, streaming: false, thinkingOpen: false }
                : m,
            ),
          );
        }
        if (event.type === "error") {
          streamingRef.current = false;
          setMessages((current) => [
            ...current,
            { role: "system", text: `Error: ${event.message}` },
          ]);
        }
      }),
    [runtime],
  );

  // Keep the <tab-select> highlight in sync when tabs change via keyboard.
  useEffect(() => {
    const idx = TABS.findIndex((t) => t.value === tab);
    tabRef.current?.setSelectedIndex(idx < 0 ? 0 : idx);
  }, [tab]);

  // OpenTUI hook: terminal window gained focus.
  useFocus(() => setWindowFocused(true));
  // OpenTUI hook: terminal window lost focus.
  useBlur(() => setWindowFocused(false));

  // OpenTUI hook: bracketed paste. We surface a toast (the focused textarea
  // already inserts the text natively, so we avoid double-inserting here).
  usePaste((event: PasteEvent) => {
    const text = decodePasteBytes(event.bytes);
    if (text.trim()) flashToast(`pasted ${text.length} chars`);
  });

  // OpenTUI hook: the user dragged a selection in the terminal.
  useSelectionHandler((selection) => {
    const text = selection.getSelectedText();
    if (text.trim()) flashToast(`selected ${text.length} chars`);
  });

  // OpenTUI hook: terminal resized — redraw crisply and flash the new size.
  useOnResize((w, h) => {
    renderer.requestRender();
    flashToast(`resized ${w}x${h}`);
  });

  // Auto-scroll bookkeeping: while on the Chat tab, poll the scrollbox every
  // frame and flag when the view has drifted away from the bottom. The
  // scrollbox's native stickyScroll keeps the latest content pinned while the
  // user is already at the bottom, so this only surfaces a hint once they
  // scroll up to read history.
  useEffect(() => {
    if (tab !== "chat") {
      setFollowHint(false);
      return;
    }
    // Poll the scrollbox a few times a second (setInterval, not rAF — the
    // terminal runtime has no requestAnimationFrame) and surface a hint once
    // the view drifts away from the bottom. We only flip state on change, so
    // idle frames are no-ops.
    const id = setInterval(() => {
      const box = chatScrollRef.current;
      if (!box) return;
      const max = Math.max(0, box.scrollHeight - box.viewport.height);
      const atBottom = box.scrollTop >= max - 1;
      setFollowHint((prev) => (prev === !atBottom ? prev : !atBottom));
    }, 150);
    return () => clearInterval(id);
  }, [tab]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "t") {
      setShowThinking((v) => !v);
      return;
    }
    if (key.ctrl && key.name === "l") {
      renderer.console.toggle();
      return;
    }
    if (key.ctrl && /^[1-4]$/.test(key.name)) {
      const next = TABS[Number(key.name) - 1];
      if (next) setTab(next.value);
      return;
    }
    if (key.name === "end" && tab === "chat") {
      const box = chatScrollRef.current;
      if (box) {
        box.scrollTop = Math.max(0, box.scrollHeight - box.viewport.height);
        setFollowHint(false);
      }
      return;
    }
    // Model picker navigation (opencode-style: arrows/ctrl-p/ctrl-n, page
    // up/down, Enter to select). Handled globally so the search input keeps
    // focus for typing while the list navigates underneath it.
    if (modelPickerOpen) {
      // While the inline key prompt is up, Enter submits the key and Escape
      // cancels back to the model list.
      if (keyPrompt) {
        if (key.name === "return") {
          void submitKey();
          return;
        }
        if (key.name === "escape") {
          setKeyPrompt(null);
          setKeyInput("");
          return;
        }
        return;
      }
      if (key.name === "up" || (key.ctrl && key.name === "p")) {
        setModelSelected((s) => (modelFlat.length ? (s - 1 + modelFlat.length) % modelFlat.length : 0));
        return;
      }
      if (key.name === "down" || (key.ctrl && key.name === "n")) {
        setModelSelected((s) => (modelFlat.length ? (s + 1) % modelFlat.length : 0));
        return;
      }
      if (key.name === "pageup") {
        setModelSelected((s) => Math.max(0, s - 10));
        return;
      }
      if (key.name === "pagedown") {
        setModelSelected((s) => Math.min(modelFlat.length - 1, s + 10));
        return;
      }
      if (key.name === "return") {
        const m = modelFlat[modelSelected];
        if (m) chooseModel(m);
        return;
      }
      if (key.name === "escape") {
        setModelPickerOpen(false);
        setModelQuery("");
        return;
      }
      return;
    }
    if (key.name === "escape") {
      statusRef.current === "thinking" ? runtime.abort() : renderer.destroy();
    }
  });

  const submit = () => {
    // Read the textarea's live value directly — relying on `draftRef` (fed by
    // `onContentChange`) can race `onSubmit` and arrive stale, which would drop
    // commands like `/models`.
    const text = (textareaRef.current?.plainText ?? draftRef.current).trim();
    if (!text || statusRef.current === "thinking") return;
    // `/models` opens the opencode-style popup selector instead of printing
    // a plain text list. An optional provider name filters the list.
    if (text === "/models" || text.startsWith("/models ")) {
      const filter = text
        .slice("/models".length)
        .trim()
        .replace(/^--?verbose\b/i, "")
        .trim()
        .toLowerCase();
      setModelQuery(filter);
      setModelPickerOpen(true);
      setDraft("");
      draftRef.current = "";
      textareaRef.current?.setText("");
      return;
    }
    setMessages((current) => [...current, { role: "you", text }]);
    setDraft("");
    draftRef.current = "";
    textareaRef.current?.setText("");
    void runtime.submit(text);
  };

  // Activate the model chosen in the popup selector. If the provider has no
  // key configured yet, open the opencode-style key prompt instead of
  // switching — the model is selected once the key is stored.
  const chooseModel = (
    model: { provider: string; id: string; name: string; baseUrl?: string } | null,
  ) => {
    if (model?.provider && model?.id) {
      const label = `${model.provider}/${model.id}`;
      if (!modelReady.has(label)) {
        setKeyPrompt({ provider: model.provider, baseUrl: model.baseUrl ?? "", pending: model });
        setKeyInput("");
        return;
      }
      const applied = runtime.setModel(model.provider, model.id);
      // Copy the provider/id selector to the system clipboard (OSC 52) and
      // confirm with a toast, so the value is ready to paste into config or
      // another session.
      const copied = renderer.copyToClipboardOSC52(applied);
      flashToast(copied ? `Switched to ${applied} · copied ${applied}` : `Switched to ${applied}`);
    }
    setModelPickerOpen(false);
    setModelQuery("");
  };

  // Store the entered API key for the prompted provider, refresh availability,
  // then complete the original selection (opencode: prompt → store → use).
  const submitKey = async () => {
    const prompt = keyPrompt;
    if (!prompt) return;
    const key = keyInput.trim();
    if (!key) {
      flashToast("API key required");
      return;
    }
    setKeyPrompt(null);
    setKeyInput("");
    try {
      const ready = await runtime.setProviderKey(prompt.provider, key);
      setModelReady(ready);
      // Re-check auth so the "(no key)" tag clears immediately.
      const info = await runtime.authInfoFor(prompt.provider);
      setModelAuth((prev) => ({ ...prev, [prompt.provider]: info ?? null }));
      // Now that the key is stored, select the originally chosen model. Use
      // the freshly-returned `ready` set (not the closure's stale state).
      const label = `${prompt.pending.provider}/${prompt.pending.id}`;
      if (ready.has(label)) {
        const applied = runtime.setModel(prompt.pending.provider, prompt.pending.id);
        const copied = renderer.copyToClipboardOSC52(applied);
        flashToast(copied ? `Switched to ${applied} · copied ${applied}` : `Switched to ${applied}`);
        setModelPickerOpen(false);
        setModelQuery("");
      } else {
        flashToast(`Key saved, but ${prompt.provider} still not ready`);
      }
    } catch (e) {
      flashToast(`Failed to store key: ${String(e)}`);
    }
  };

  const roleColor = (role: Message["role"]) =>
    role === "wednesday"
      ? COLORS.wednesday
      : role === "you"
        ? COLORS.you
        : COLORS.system;

  // Memories panel: filter the recalled titles.
  const filteredRecalled = recalled.filter((m) =>
    m.toLowerCase().includes(memoryFilter.trim().toLowerCase()),
  );

  // Tools panel: detail text for the highlighted option.
  const showToolDetail = (option: SelectOption | null) => {
    if (!option) {
      setToolDetail("");
      return;
    }
    const v = option.value as { runnable: boolean; raw: string } | undefined;
    if (v?.runnable) {
      const cmd = LOCAL_COMMANDS.find((c) => c.cmd === option.name);
      setToolDetail(
        `${option.name}\n${cmd?.desc ?? ""}\n\nPress Enter to run — switches to Chat and submits.`,
      );
    } else {
      setToolDetail(
        JSON.stringify(
          { tool: option.name, description: option.description },
          null,
          2,
        ),
      );
    }
  };

  const runTool = (option: SelectOption | null) => {
    const v = option?.value as { runnable: boolean; raw: string } | undefined;
    if (v?.runnable && v.raw) {
      setTab("chat");
      void runtime.submit(v.raw);
    }
  };

  const configSummary = JSON.stringify(
    {
      model: stats.modelId,
      thinkingLevel: stats.thinkingLevel,
      workspace: shortPath(stats.workspace),
      contextWindow: stats.contextWindow,
      maxOutput: stats.maxOutputAuto ? "auto" : stats.maxOutput,
    },
    null,
    2,
  );

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: COLORS.bg,
      }}
    >
      {/* Header: status pill + animated thinking bar, then the tab switcher. */}
      <box
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: SP.sm,
          paddingRight: SP.sm,
          height: 3,
          gap: 2,
        }}
      >
        <StatusPill status={status} />
        <ThinkingBar active={status === "thinking"} />
        <box style={{ flexGrow: 1 }} />
        <tab-select
          ref={tabRef}
          options={TABS}
          onChange={(_, option) => {
            const v = option?.value as Tab | undefined;
            if (v) setTab(v);
          }}
          style={{ height: 3 }}
        />
      </box>
      <Divider />

      {/* Main panel (switches by tab) */}
      {tab === "chat" && (
        <box style={{ flexDirection: "column", flexGrow: 1 }}>
          <scrollbox
            ref={chatScrollRef}
            style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}
            stickyScroll
            stickyStart="bottom"
            scrollbarOptions={{ visible: false }}
          >
            <box style={{ flexDirection: "column", gap: 1 }}>
              {messages.map((message, index) => {
                // Welcome banner is rendered full-bleed (no rail/label).
                if (message.banner) {
                  return (
                    <box key={index} style={{ flexDirection: "column", paddingBottom: 1 }}>
                      <text fg={COLORS.wednesday}>{message.banner}</text>
                      {message.text ? (
                        <text fg={COLORS.system}>{message.text}</text>
                      ) : null}
                    </box>
                  );
                }
                const railColor = roleColor(message.role);
                const roleName =
                  message.role === "wednesday"
                    ? "Wednesday"
                    : message.role === "you"
                      ? "You"
                      : "Local";
                const open = message.thinkingOpen || showThinking;
                return (
                  <box
                    key={index}
                    style={{ flexDirection: "row", gap: 1, paddingBottom: 1 }}
                  >
                    {/* Accent rail: thin color key per speaker. */}
                    <text fg={railColor}>│</text>
                    <box style={{ flexDirection: "column", flexGrow: 1 }}>
                      <box
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 1,
                        }}
                      >
                        <text fg={railColor}>
                          <b>{roleName}</b>
                        </text>
                        {message.role === "you" ? null : (
                          <text fg={COLORS.border}>·</text>
                        )}
                      </box>
                      {message.thinking ? (
                        <box style={{ flexDirection: "column", paddingTop: 0 }}>
                          <text fg={COLORS.muted}>
                            {open ? "▾ thinking" : "▸ thinking (Ctrl+T)"}
                          </text>
                          {open ? (
                            <text fg={COLORS.system} style={{ paddingLeft: 2 }}>
                              {message.thinking}
                            </text>
                          ) : null}
                        </box>
                      ) : null}
                      {message.role === "wednesday" ? (
                        <markdown
                          content={message.text}
                          syntaxStyle={syntax}
                          streaming={message.streaming}
                          style={{ flexShrink: 1 }}
                        />
                      ) : (
                        <text fg={COLORS.system}>{message.text}</text>
                      )}
                    </box>
                  </box>
                );
              })}
            </box>
          </scrollbox>
          {/* Composer: a titled box with a model/effort chip in its title bar,
              a focus-aware border, and a contextual placeholder. */}
          <box
            title={` Message · ${stats.modelId} · ${stats.thinkingLevel} `}
            style={{
              height: 5,
              marginLeft: 1,
              marginRight: 1,
              border: true,
              borderColor:
                status === "thinking" ? COLORS.thinking : COLORS.wednesday,
              paddingLeft: 1,
              paddingRight: 1,
            }}
          >
            <textarea
              ref={textareaRef}
              initialValue={draft}
              onSubmit={submit}
              onContentChange={() => {
                const text = textareaRef.current?.plainText ?? "";
                draftRef.current = text;
                setDraft(text);
              }}
              keyBindings={[
                { name: "return", action: "submit" },
                { name: "kpenter", action: "submit" },
                { name: "return", shift: true, action: "newline" },
                { name: "kpenter", shift: true, action: "newline" },
                { name: "return", meta: true, action: "newline" },
                { name: "kpenter", meta: true, action: "newline" },
              ]}
              focused={status !== "thinking" && !modelPickerOpen}
              placeholder={
                status === "thinking"
                  ? "Wednesday is thinking…"
                  : "Ask Wednesday anything…"
              }
            />
          </box>
        </box>
      )}

      {tab === "tools" && (
        <box style={{ flexDirection: "column", flexGrow: 1, padding: 1, gap: 1 }}>
          <SectionHeader
            label="Tools & Commands"
            right={`${toolOptions.length} entries`}
          />
          <Divider />
          <box style={{ flexDirection: "row", gap: 1, alignItems: "center", paddingLeft: 1, paddingRight: 1 }}>
            <text fg={HINT}>⌕</text>
            <input
              placeholder="Filter tools / commands…"
              focused={tab === "tools"}
              onInput={setToolFilter}
              style={{ flexGrow: 1 }}
            />
          </box>
          <box style={{ flexDirection: "row", flexGrow: 1, gap: 1 }}>
            <select
              style={{ width: "50%", flexGrow: 1 }}
              options={toolOptions}
              focused={tab === "tools"}
              showDescription
              showScrollIndicator
              onChange={(_, o) => showToolDetail(o)}
              onSelect={(_, o) => runTool(o)}
            />
            <box
              border
              borderColor={COLORS.border}
              style={{ width: "50%", flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}
            >
              <scrollbox
                style={{ flexGrow: 1 }}
                scrollbarOptions={{ visible: false }}
              >
                <code
                  content={toolDetail || "# Pick a tool or command on the left"}
                  syntaxStyle={syntax}
                  style={{ width: "100%" }}
                />
              </scrollbox>
            </box>
          </box>
        </box>
      )}

      {tab === "memories" && (
        <box style={{ flexDirection: "column", flexGrow: 1, padding: 1, gap: 1 }}>
          <SectionHeader
            label="Recalled Memories"
            right={`${filteredRecalled.length} / ${recalled.length}`}
          />
          <Divider />
          <box style={{ flexDirection: "row", gap: 1, alignItems: "center", paddingLeft: 1, paddingRight: 1 }}>
            <text fg={HINT}>⌕</text>
            <input
              placeholder="Filter recalled memories…"
              focused={tab === "memories"}
              onInput={setMemoryFilter}
              style={{ flexGrow: 1 }}
            />
          </box>
          <scrollbox
            style={{ flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}
            scrollbarOptions={{ visible: false }}
          >
            {filteredRecalled.length === 0 ? (
              <text fg={HINT}>
                No memories recalled yet — ask a question or run /recall.
              </text>
            ) : (
              <box style={{ flexDirection: "column", gap: 1 }}>
                {filteredRecalled.map((m, i) => (
                  <box
                    key={i}
                    border
                    borderColor={COLORS.wednesday}
                    style={{ paddingLeft: 1, paddingRight: 1 }}
                  >
                    <text fg={COLORS.chip}>{truncate(m, 80)}</text>
                  </box>
                ))}
              </box>
            )}
          </scrollbox>
        </box>
      )}

      {tab === "about" && (
        <box style={{ flexDirection: "column", flexGrow: 1, padding: 2, gap: 1 }}>
          <ascii-font text="Wednesday" font="slick" color={COLORS.wednesday} />
          <text fg={COLORS.you}>
            Local-first personal agent · Pi Agent Core + OpenTUI
          </text>
          <Divider />
          <box style={{ flexDirection: "column", gap: 0 }}>
            <box style={{ flexDirection: "row" }}>
              <text fg={COLORS.muted} style={{ width: 14 }}>model</text>
              <text fg={COLORS.system}>
                {stats.modelId} · {stats.thinkingLevel}
              </text>
            </box>
            <box style={{ flexDirection: "row" }}>
              <text fg={COLORS.muted} style={{ width: 14 }}>workspace</text>
              <text fg={COLORS.system}>{shortPath(stats.workspace)}</text>
            </box>
            <box style={{ flexDirection: "row" }}>
              <text fg={COLORS.muted} style={{ width: 14 }}>context</text>
              <text fg={COLORS.system}>
                {stats.contextPct.toFixed(1)}% /{" "}
                {Math.round(stats.contextWindow / 1000)}k
              </text>
            </box>
          </box>
          <code
            content={configSummary}
            filetype="json"
            syntaxStyle={syntax}
            style={{ flexGrow: 1 }}
          />
          <Divider />
          <text fg={HINT}>
            Ctrl+T thinking · Ctrl+1-4 tabs · Ctrl+L console · Esc quit ·
            ↑/↓ approve · Enter send
          </text>
          <text fg={HINT}>End · jump to latest message in Chat</text>
        </box>
      )}

      {/* Footer: a single status bar — workspace/dims, live token + context
          stats, and model · effort (with the toast). A thin follow hint rides
          above it when the chat has scrolled away from the latest message. */}
      <box
        style={{
          height: 3,
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {tab === "chat" && followHint ? (
          <text fg={COLORS.you}>↓ new messages below · End to jump to latest</text>
        ) : (
          <box style={{ height: 1 }} />
        )}
        <box
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingLeft: SP.sm,
            paddingRight: SP.sm,
            gap: 1,
          }}
        >
          <text fg={HINT}>
            {shortPath(stats.workspace)} {SEP} {dims.width}×{dims.height}
            {windowFocused ? "" : ` ${SEP} background`}
          </text>
          <text fg={HINT}>
            ↑{fmtTokens(stats.usage.input)} ↓{fmtTokens(stats.usage.output)} R
            {fmtTokens(stats.usage.reasoning)} {SEP} CH
            {stats.cacheHitPct.toFixed(1)}% {SEP} {stats.contextPct.toFixed(1)}%/
            {Math.round(stats.contextWindow / 1000)}k{" "}
            ({stats.maxOutputAuto ? "auto" : fmtTokens(stats.maxOutput)})
          </text>
          <text fg={toast ? COLORS.you : HINT}>
            {stats.modelId} · {stats.thinkingLevel}
            {toast ? `  ${toast}` : ""}
          </text>
        </box>
      </box>

      {/* /models popup selector — a centered, modal command-palette. Strong
          header, grouped provider sections with live status chips, scannable
          right-aligned metadata, a spec-sheet detail panel, and a built-in
          keymap footer. Navigation is handled in the global key handler. */}
      {modelPickerOpen && (
        <box
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: COLORS.bg,
            zIndex: 100,
          }}
        >
          <box
            border
            borderColor={COLORS.wednesday}
            style={{
              width: "78%",
              maxWidth: 92,
              height: Math.max(
                14,
                Math.min(
                  modelFlat.length + modelGroups.length * 2 + 16,
                  Math.floor(dims.height * 0.84),
                ),
              ),
              flexDirection: "column",
              backgroundColor: COLORS.bg,
              paddingLeft: 1,
              paddingRight: 1,
              paddingTop: 1,
              paddingBottom: 1,
            }}
          >
            {/* Header: title + live result count, with an accent rule beneath. */}
            <box
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingLeft: 2,
                paddingRight: 2,
                paddingBottom: 1,
              }}
            >
              <text fg={COLORS.wednesday}>
                <b>Select model</b>
              </text>
              <box style={{ flexDirection: "row", gap: 1, alignItems: "center" }}>
                <text fg={COLORS.muted}>
                  {modelFlat.length} {modelFlat.length === 1 ? "model" : "models"}
                </text>
                <text fg={COLORS.border}>·</text>
                <text fg={COLORS.muted}>esc to close</text>
              </box>
            </box>
            <box style={{ height: 1, backgroundColor: COLORS.border }} />

            {/* Search field with a prompt glyph and a count-aware placeholder. */}
            <box style={{ paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
              <box style={{ flexDirection: "row", gap: 1, alignItems: "center" }}>
                <text fg={COLORS.wednesday}>›</text>
                <input
                  placeholder={
                    modelQuery ? "Search models…" : "Search by name or provider…"
                  }
                  focused={modelPickerOpen}
                  value={modelQuery}
                  onInput={setModelQuery}
                  style={{ flexGrow: 1 }}
                />
              </box>
            </box>

            {/* Body: grouped, scrollable list (left) + detail panel (right). */}
            {modelGroups.length === 0 ? (
              <box style={{ flexGrow: 1, paddingLeft: 4, paddingRight: 4, paddingTop: 2 }}>
                <text fg={COLORS.muted}>No models match “{modelQuery}”.</text>
              </box>
            ) : (
              <box style={{ flexDirection: "row", flexGrow: 1, gap: 1 }}>
                <scrollbox
                  ref={modelScrollRef}
                  style={{ width: "60%", flexGrow: 1 }}
                  scrollbarOptions={{ visible: false }}
                >
                  <box style={{ flexDirection: "column" }}>
                    {modelGroups.map((group, gi) => {
                      const configured = Boolean(modelAuth[group.provider]);
                      return (
                        <box key={group.provider} style={{ flexDirection: "column" }}>
                          {/* Provider eyebrow: name + model count on the left,
                              a key-status chip on the right. */}
                          <box
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                              paddingTop: gi > 0 ? 1 : 0,
                              paddingLeft: 2,
                              paddingRight: 2,
                            }}
                          >
                            <box style={{ flexDirection: "row", gap: 1, alignItems: "center" }}>
                              <text fg={COLORS.you}>
                                <b>{group.provider}</b>
                              </text>
                              <text fg={COLORS.muted}>{group.items.length}</text>
                            </box>
                            <text fg={configured ? COLORS.wednesday : COLORS.error}>
                              {configured ? "✓ configured" : "⚿ needs key"}
                            </text>
                          </box>
                          {group.items.map((m) => {
                            const flatIndex = modelFlat.indexOf(m);
                            const active = flatIndex === modelSelected;
                            const current = m.active;
                            const ready = modelReady.has(`${m.provider}/${m.id}`);
                            return (
                              <box
                                key={`${m.provider}/${m.id}`}
                                id={`model:${m.provider}/${m.id}`}
                                onMouseUp={() => chooseModel(m)}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 1,
                                  paddingLeft: active ? 1 : 3,
                                  paddingRight: 2,
                                  backgroundColor: active ? COLORS.wednesday : COLORS.bg,
                                }}
                              >
                                <text fg={active ? COLORS.bg : COLORS.chip}>
                                  {active ? "▸ " : "  "}
                                  {current ? "● " : "  "}
                                  {m.name}
                                </text>
                                {/* Right-aligned scan column: capability chips
                                    then context size. */}
                                <box
                                  style={{
                                    flexGrow: 1,
                                    flexDirection: "row",
                                    justifyContent: "flex-end",
                                    gap: 1,
                                    alignItems: "center",
                                  }}
                                >
                                  {m.reasoning ? (
                                    <text fg={active ? COLORS.bg : COLORS.muted}>reason</text>
                                  ) : null}
                                  {m.vision ? (
                                    <text fg={active ? COLORS.bg : COLORS.muted}>vision</text>
                                  ) : null}
                                  {!ready ? (
                                    <text fg={active ? COLORS.bg : COLORS.error}>key?</text>
                                  ) : null}
                                  <text fg={active ? COLORS.bg : COLORS.muted}>
                                    {Math.round(m.contextWindow / 1000)}k
                                  </text>
                                </box>
                              </box>
                            );
                          })}
                        </box>
                      );
                    })}
                  </box>
                </scrollbox>

                {/* Detail panel: a clean spec sheet for the highlighted model. */}
                <box
                  border
                  borderColor={COLORS.border}
                  style={{
                    width: "40%",
                    flexGrow: 1,
                    flexDirection: "column",
                    backgroundColor: COLORS.bg,
                    paddingLeft: 1,
                    paddingRight: 1,
                    paddingTop: 1,
                  }}
                >
                  {(() => {
                    const m = modelFlat[modelSelected];
                    if (!m) return null;
                    const c = m.cost;
                    const rows: Array<[string, string]> = [
                      ["api", String(m.api)],
                      ...(m.baseUrl ? [["base", m.baseUrl] as [string, string]] : []),
                      ["context", `${m.contextWindow.toLocaleString()} tok`],
                      ["max out", `${m.maxTokens.toLocaleString()} tok`],
                      ["input", m.input.join(", ")],
                      ["cost", `in $${c.input.toFixed(2)} · out $${c.output.toFixed(2)}`],
                      [
                        "cache",
                        `R $${c.cacheRead.toFixed(2)} · W $${c.cacheWrite.toFixed(2)}`,
                      ],
                    ];
                    return (
                      <box style={{ flexDirection: "column" }}>
                        <text fg={COLORS.wednesday}>
                          <b>{m.name}</b>
                        </text>
                        <text fg={COLORS.muted}>{m.id}</text>
                        <box style={{ height: 1, backgroundColor: COLORS.border }} />
                        {rows.map(([k, v], i) => (
                          <text key={i} fg={COLORS.system}>
                            {`${k}`.padEnd(11)}
                            {v}
                          </text>
                        ))}
                        <text fg={COLORS.system} style={{ paddingTop: 1 }}>
                          {`thinking`.padEnd(11)}
                          {m.thinkingLevels.length
                            ? m.thinkingLevels.join("  ·  ")
                            : "none"}
                        </text>
                        <box style={{ flexGrow: 1 }} />
                        <box style={{ paddingTop: 1 }}>
                          <text fg={COLORS.wednesday}>
                            ⏎ use · copied to clipboard
                          </text>
                        </box>
                      </box>
                    );
                  })()}
                </box>
              </box>
            )}

            {/* Keymap footer — built-in discoverability, like a real palette. */}
            <box
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingLeft: 2,
                paddingRight: 2,
                paddingTop: 1,
              }}
            >
              <text fg={COLORS.muted}>
                <b fg={COLORS.you}>↑↓</b> navigate ·{" "}
                <b fg={COLORS.you}>pgup/pgdn</b> jump
              </text>
              <text fg={COLORS.muted}>
                <b fg={COLORS.you}>⏎</b> select ·{" "}
                <b fg={COLORS.you}>esc</b> close
              </text>
            </box>
          </box>

          {/* Inline key prompt: shown when a model from an unconfigured
              provider is selected. Enter the API key — it is stored in the
              OS keychain and the chosen model is then selected. */}
          {keyPrompt && (
            <box
              border
              borderColor={COLORS.error}
              style={{
                position: "absolute",
                top: "32%",
                width: "60%",
                maxWidth: 64,
                flexDirection: "column",
                backgroundColor: COLORS.bg,
                paddingLeft: 1,
                paddingRight: 1,
                paddingTop: 1,
                paddingBottom: 1,
                zIndex: 200,
              }}
            >
              <box style={{ flexDirection: "row", gap: 1, paddingLeft: 1, paddingRight: 1, paddingBottom: 1 }}>
                <text fg={COLORS.error}>⚿</text>
                <text fg={COLORS.you}>
                  <b>Add API key — {keyPrompt.provider}</b>
                </text>
              </box>
              <box style={{ paddingLeft: 1, paddingRight: 1 }}>
                <text fg={COLORS.muted}>
                  {keyPrompt.baseUrl
                    ? `Base ${keyPrompt.baseUrl} · paste the key for ${keyPrompt.pending.name}`
                    : `Paste an API key for ${keyPrompt.pending.name}`}
                </text>
              </box>
              <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, flexDirection: "row", gap: 1, alignItems: "center" }}>
                <text fg={COLORS.error}>🔑</text>
                <input
                  placeholder="sk-…"
                  focused={Boolean(keyPrompt)}
                  value={keyInput}
                  onInput={setKeyInput}
                  style={{ flexGrow: 1 }}
                  ref={(el: { setText: (s: string) => void } | null) => {
                    keyInputRef.current = el;
                  }}
                />
              </box>
              <box
                style={{
                  flexDirection: "row",
                  justifyContent: "flex-end",
                  gap: 2,
                  paddingLeft: 1,
                  paddingRight: 1,
                  paddingTop: 1,
                }}
              >
                <text fg={COLORS.muted}>
                  <b fg={COLORS.you}>⏎</b> save
                </text>
                <text fg={COLORS.muted}>
                  <b fg={COLORS.you}>esc</b> cancel
                </text>
              </box>
            </box>
          )}
        </box>
      )}
    </box>
  );
}
