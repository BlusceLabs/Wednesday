import type { IntegrationsConfig } from "../core/config";

export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  location?: string;
}

/**
 * Pluggable calendar adapter. Only a "none" provider ships today. There is
 * no bundled Google Calendar / Microsoft Graph OAuth flow here, because a
 * real integration needs a live client id/secret and an interactive user
 * consent redirect that cannot be completed inside this environment.
 *
 * To wire a real provider:
 *   1. Register an OAuth app with Google Calendar or Microsoft Graph.
 *   2. Store the client id/secret and refresh token with `SecretStore`
 *      (see core/secrets.ts), the same way model provider keys are stored.
 *   3. Set integrations.calendar.provider and implement the branch below
 *      using that provider's REST API.
 * Until then, any non-"none" provider still throws a clear configuration
 * error, so Wednesday never pretends to have live calendar access.
 */
export async function listEvents(
  config: IntegrationsConfig["calendar"],
): Promise<CalendarEvent[]> {
  if (config.provider === "none")
    throw new Error(
      "Calendar integration is not configured. Set integrations.calendar.provider " +
        "with `bun run config -- set integrations.calendar.provider google` and " +
        "implement the adapter in src/integrations/calendar.ts.",
    );
  throw new Error(
    `Calendar provider '${config.provider}' has no adapter implementation yet. ` +
      "Implement it in src/integrations/calendar.ts.",
  );
}
