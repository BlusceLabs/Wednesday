import type { IntegrationsConfig } from "../core/config";

export interface EmailMessage {
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
}

/**
 * Pluggable email adapter, mirroring integrations/calendar.ts. Only a
 * "none" provider ships today — a real Gmail/Outlook integration needs a
 * live OAuth client and user consent that can't be completed inside this
 * environment.
 *
 * To wire a real provider:
 *   1. Register an OAuth app with Gmail API or Microsoft Graph (Outlook).
 *   2. Store credentials with `SecretStore` (see core/secrets.ts).
 *   3. Set integrations.email.provider and implement the branch below
 *      using that provider's REST API.
 */
export async function listMessages(
  config: IntegrationsConfig["email"],
): Promise<EmailMessage[]> {
  if (config.provider === "none")
    throw new Error(
      "Email integration is not configured. Set integrations.email.provider " +
        "with `bun run config -- set integrations.email.provider gmail` and " +
        "implement the adapter in src/integrations/email.ts.",
    );
  throw new Error(
    `Email provider '${config.provider}' has no adapter implementation yet. ` +
      "Implement it in src/integrations/email.ts.",
  );
}
