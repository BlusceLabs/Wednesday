import { WednesdayRuntime } from "./agent/runtime";
import { BrowserUse } from "./browser/use";
import { initializeConfig, loadConfig } from "./core/config";
import { WednesdayEventBus } from "./core/events";
import { EventJournal } from "./core/journal";
import { PermissionService } from "./core/permissions";
import { providerSecretName, SecretStore } from "./core/secrets";
import { GitHistory } from "./history/git";
import { MemoryIndex } from "./memory/index";
import { MarkdownVault } from "./memory/vault";
import { createEmbedder } from "./memory/embeddings";
import { WednesdayModelManager } from "./models/manager";
import { DockerSandbox } from "./sandbox/docker";
import { TaskScheduler } from "./scheduler";
import { SessionStore } from "./sessions/store";

export async function bootstrap() {
  initializeConfig();
  const config = loadConfig();
  const secrets = new SecretStore();
  const vault = new MarkdownVault(config.vault);
  const journal = new EventJournal(config.journal);
  const sessions = new SessionStore(config.sessionFile);
  const history = new GitHistory(config.vault, config.gitHistory);
  const browser = new BrowserUse(config.browser);
  const sandbox = new DockerSandbox(config.sandbox);

  // These setup steps are independent of one another (disk I/O, OS
  // keychain lookups, and a git subprocess call) and previously ran one
  // after another; running them concurrently cuts Wednesday's startup
  // latency down to the slowest single step instead of their sum. The
  // memory index now performs an incremental `sync()` (only re-embedding
  // changed/new vault files) instead of a full `rebuild()`, which also
  // scales much better as the vault grows.
  // Keep the three independent data loads concurrent (startup latency is
  // bounded by the slowest, per rc.6) but name each result explicitly
  // instead of destructuring a 6-promise Promise.all into 3 variables —
  // that earlier shape silently discarded results and was a misassignment
  // footgun if the tuple was ever reordered.
  const apiKeyPromise = secrets.get(
    providerSecretName(config.model.provider),
  );
  const embedder = createEmbedder(config.memory.embedder ?? "hash");
  const indexPromise = MemoryIndex.create(
    config.index,
    config.memory.embeddingsEnabled,
    embedder,
  ).then(async (created) => {
    await created.sync(config.vault);
    return created;
  });
  const messagesPromise = sessions.load();
  const [apiKey, index, messages] = await Promise.all([
    apiKeyPromise,
    indexPromise,
    messagesPromise,
  ]);
  // Side-effect-only initializers run in parallel.
  await Promise.all([
    vault.initialize(),
    journal.initialize(),
    history.initialize(),
  ]);
  const models = new WednesdayModelManager(config, apiKey, secrets);
  const events = new WednesdayEventBus();
  const permissions = new PermissionService({ gitRemote: config.git.remote });
  const runtime = new WednesdayRuntime(
    events,
    models,
    vault,
    index,
    journal,
    sessions,
    history,
    browser,
    sandbox,
    config,
    messages,
    permissions,
    secrets,
  );
  const scheduler = new TaskScheduler(config.scheduler, runtime, journal);
  return {
    config,
    secrets,
    vault,
    index,
    journal,
    models,
    sessions,
    history,
    browser,
    sandbox,
    runtime,
    scheduler,
  };
}
