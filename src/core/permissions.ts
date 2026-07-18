const READ_ONLY = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "memory_search",
  "memory_read",
]);

// Tools that may run without an interactive approval prompt. They were
// formerly gated behind a user "Approve/Deny" dialog; that dialog has been
// removed, so these now execute directly. They are kept as an explicit
// allow-list so the unknown-tool block below stays meaningful.
export const ALLOWED_TOOLS = new Set([
  "memory_remember",
  "sandbox_shell",
  "browser_use",
  "cloakbrowser_use",
  "scrapling_extract",
  "computer_write_file",
  "computer_edit_file",
  "computer_apply_patch",
  "computer_terminal",
  "git_push",
  "git_pull",
  "browser_screenshot",
  "calendar_list_events",
  "email_list_messages",
  "voice_speak",
]);

const SAFE_PREFIXES = [
  "text_",
  "math_",
  "date_",
  "data_",
  "workspace_",
  "git_",
];

/**
 * Lightweight safety gate invoked before each tool call. Read-only,
 * safe-prefixed, and allow-listed tools run freely; anything else is blocked
 * with a reason rather than executed. There is no longer any interactive
 * approval step — tools either run or are refused outright.
 */
export class PermissionService {
  constructor(
    private readonly options: { gitRemote?: string | null } = {},
  ) {}

  async check(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<{ block?: true; reason?: string } | undefined> {
    // Prompt-injection guard: never push/pull to a remote other than the
    // configured one, checked before the general allow-list below so it
    // can't be bypassed by an allow-listed tool name. The shipped tools
    // don't expose a remote argument, but this blocks any future/rogue call
    // that tries to redirect the sync destination.
    if (toolName === "git_push" || toolName === "git_pull") {
      const remote = args.remote;
      if (
        typeof remote === "string" &&
        this.options.gitRemote &&
        remote !== this.options.gitRemote
      )
        return {
          block: true,
          reason: `Refusing to ${toolName} to unconfigured remote '${remote}'.`,
        };
    }
    if (
      READ_ONLY.has(toolName) ||
      ALLOWED_TOOLS.has(toolName) ||
      SAFE_PREFIXES.some((prefix) => toolName.startsWith(prefix))
    )
      return undefined;
    return {
      block: true,
      reason: `Wednesday blocks '${toolName}' because no permission policy exists for it.`,
    };
  }
}
