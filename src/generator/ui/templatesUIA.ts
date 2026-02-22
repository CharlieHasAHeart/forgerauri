import type { SpecIR } from "../../spec/schema.js";
import { toScreenSlug } from "./slug.js";

type ScreenDef = {
  name: string;
  purpose: string;
  primaryActions: string[];
  slug: string;
};

const sortedScreens = (ir: SpecIR): ScreenDef[] =>
  [...ir.screens]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((screen) => ({
      name: screen.name,
      purpose: screen.purpose ?? "",
      primaryActions: [...screen.primary_actions],
      slug: toScreenSlug(screen.name)
    }));

const escapeText = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const templateScreensIndex = (ir: SpecIR): string => {
  const screens = sortedScreens(ir);
  const rows = screens
    .map((screen) => {
      const actions = screen.primaryActions.map((action) => `"${escapeText(action)}"`).join(", ");
      return `  {
    name: "${escapeText(screen.name)}",
    purpose: "${escapeText(screen.purpose)}",
    slug: "${screen.slug}",
    primary_actions: [${actions}]
  }`;
    })
    .join(",\n");

  return `export type ScreenMeta = {
  name: string;
  purpose: string;
  slug: string;
  primary_actions: string[];
};

export const screens: ScreenMeta[] = [
${rows}
];
`;
};

export const templateScreenSvelte = (screen: ScreenDef): string => {
  const actions = screen.primaryActions.map((action) => `  "${escapeText(action)}"`).join(",\n");

  return `<script lang="ts">
  const name = "${escapeText(screen.name)}";
  const purpose = "${escapeText(screen.purpose)}";
  const actions = [
${actions}
  ];
</script>

<section>
  <h1>{name}</h1>
  <p>{purpose}</p>

  <h2>Primary Actions</h2>
  {#if actions.length === 0}
    <p>No primary actions defined.</p>
  {:else}
    <ul>
      {#each actions as action}
        <li>{action}</li>
      {/each}
    </ul>
  {/if}
</section>
`;
};

export const templateAppWithScreensNav = (ir: SpecIR): string => {
  const screens = sortedScreens(ir);

  const imports = screens
    .map((screen, index) => `  "${screen.slug}": Screen${index}`)
    .join(",\n");

  const componentImports = screens
    .map((screen, index) => `import Screen${index} from "../screens/generated/${screen.slug}.svelte";`)
    .join("\n");

  const commandFallback = screens.length > 0 ? `let currentSlug = screens[0].slug;` : 'let currentSlug = "";';
  const screenComponentType = screens.length > 0 ? "unknown" : "null";
  const screenComponentMap = screens.length > 0 ? `{\n${imports}\n  }` : "{}";

  return `<script lang="ts">
  import { invokeCommand } from "../api/tauri";
  import { generatedCommands, listCommandRuns, runGeneratedCommand, type GeneratedCommandMeta } from "../api/generated/commands";
  import { screens } from "../screens/generated";
${componentImports}

  type DbHealth = {
    schema_version: number;
    db_path: string;
    ok: boolean;
    message?: string;
  };

  type ScreenComponent = ${screenComponentType};

  const screenComponents: Record<string, ScreenComponent> = ${screenComponentMap};

  ${commandFallback}
  let pingResult = "";
  let pingError = "";
  let pingLoading = false;

  let dbMessage = "";
  let dbError = "";
  let dbLoading = false;

  let selectedInvokeName = generatedCommands[0]?.invokeName ?? "";
  let commandResult = "";
  let commandError = "";
  let commandLoading = false;

  let runsResult = "";
  let runsError = "";
  let runsLoading = false;

  let formValues: Record<string, unknown> = {};

  const selectedCommand = (): GeneratedCommandMeta | undefined =>
    generatedCommands.find((command) => command.invokeName === selectedInvokeName);

  const currentScreenComponent = (): ScreenComponent | null => {
    return screenComponents[currentSlug] ?? null;
  };

  const resetForm = () => {
    formValues = {};
    const command = selectedCommand();
    if (!command) return;

    for (const field of command.input) {
      if (field.kind === "boolean") {
        formValues[field.name] = false;
      } else {
        formValues[field.name] = "";
      }
    }
  };

  resetForm();

  const ping = async () => {
    pingLoading = true;
    pingError = "";
    pingResult = "";

    try {
      pingResult = await invokeCommand<string>("ping");
    } catch (err) {
      pingError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      pingLoading = false;
    }
  };

  const dbHealthCheck = async () => {
    dbLoading = true;
    dbError = "";
    dbMessage = "";

    try {
      const health = await invokeCommand<DbHealth>("db_health_check");
      dbMessage =
        "ok=" +
        String(health.ok) +
        ", schema_version=" +
        String(health.schema_version) +
        ", db_path=" +
        health.db_path +
        (health.message ? ", message=" + health.message : "");
    } catch (err) {
      dbError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      dbLoading = false;
    }
  };

  const parseInputValue = (kind: string, value: unknown): unknown => {
    if (kind === "boolean") {
      return Boolean(value);
    }

    if (kind === "number") {
      if (typeof value === "number") return value;
      const parsed = Number(String(value));
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    if (kind === "json") {
      if (typeof value === "string" && value.trim().length > 0) {
        return JSON.parse(value);
      }
      return {};
    }

    return typeof value === "string" ? value : String(value ?? "");
  };

  const runCommand = async () => {
    commandLoading = true;
    commandError = "";
    commandResult = "";

    try {
      const command = selectedCommand();
      if (!command) {
        throw new Error("No generated command available");
      }

      const payload: Record<string, unknown> = {};
      for (const field of command.input) {
        const rawValue = formValues[field.name];
        if (field.optional && (rawValue === "" || rawValue === undefined || rawValue === null)) {
          continue;
        }
        payload[field.name] = parseInputValue(field.kind, rawValue);
      }

      const result = await runGeneratedCommand(command.invokeName, payload);
      commandResult = JSON.stringify(result, null, 2);
    } catch (err) {
      commandError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      commandLoading = false;
    }
  };

  const loadRuns = async () => {
    runsLoading = true;
    runsError = "";
    runsResult = "";

    try {
      const runs = await listCommandRuns(5);
      runsResult = JSON.stringify(runs, null, 2);
    } catch (err) {
      runsError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      runsLoading = false;
    }
  };
</script>

<main>
  <section>
    <h2>Screens</h2>
    <nav>
      {#if screens.length === 0}
        <p>No screens in spec.</p>
      {:else}
        {#each screens as screen}
          <button
            class:active={currentSlug === screen.slug}
            on:click={() => {
              currentSlug = screen.slug;
            }}
          >
            {screen.name}
          </button>
        {/each}
      {/if}
    </nav>

    {#if currentScreenComponent()}
      <svelte:component this={currentScreenComponent() as never} />
    {/if}
  </section>

  <section>
    <button on:click={ping} disabled={pingLoading}>{pingLoading ? "Pinging..." : "Ping"}</button>
    {#if pingResult}
      <p>Ping: {pingResult}</p>
    {/if}
    {#if pingError}
      <p>Error: {pingError}</p>
    {/if}
  </section>

  <section>
    <button on:click={dbHealthCheck} disabled={dbLoading}>{dbLoading ? "Checking..." : "DB Health Check"}</button>
    {#if dbMessage}
      <p>DB: {dbMessage}</p>
    {/if}
    {#if dbError}
      <p>DB Error: {dbError}</p>
    {/if}
  </section>

  <section>
    <h2>Commands Demo</h2>
    {#if generatedCommands.length === 0}
      <p>No generated commands found in spec.</p>
    {:else}
      <label>
        Command
        <select bind:value={selectedInvokeName} on:change={resetForm}>
          {#each generatedCommands as command}
            <option value={command.invokeName}>{command.name}</option>
          {/each}
        </select>
      </label>

      {#if selectedCommand()}
        {#each selectedCommand()!.input as field}
          <div class="field">
            <label>{field.name} ({field.type})</label>
            {#if field.kind === "boolean"}
              <input
                type="checkbox"
                checked={Boolean(formValues[field.name])}
                on:change={(event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  formValues = { ...formValues, [field.name]: target.checked };
                }}
              />
            {:else if field.kind === "json"}
              <textarea
                value={String(formValues[field.name] ?? "")}
                on:input={(event) => {
                  const target = event.currentTarget as HTMLTextAreaElement;
                  formValues = { ...formValues, [field.name]: target.value };
                }}
              ></textarea>
            {:else}
              <input
                type={field.kind === "number" ? "number" : "text"}
                value={String(formValues[field.name] ?? "")}
                on:input={(event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  formValues = { ...formValues, [field.name]: target.value };
                }}
              />
            {/if}
          </div>
        {/each}
      {/if}

      <button on:click={runCommand} disabled={commandLoading}>
        {commandLoading ? "Running..." : "Run Command"}
      </button>

      {#if commandResult}
        <pre>{commandResult}</pre>
      {/if}
      {#if commandError}
        <p>Command Error: {commandError}</p>
      {/if}

      <button on:click={loadRuns} disabled={runsLoading}>{runsLoading ? "Loading..." : "List Runs"}</button>
      {#if runsResult}
        <pre>{runsResult}</pre>
      {/if}
      {#if runsError}
        <p>Runs Error: {runsError}</p>
      {/if}
    {/if}
  </section>
</main>

<style>
  main {
    font-family: sans-serif;
    margin: 2rem;
    display: grid;
    gap: 1rem;
  }

  section {
    border: 1px solid #ddd;
    padding: 1rem;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  button.active {
    font-weight: 700;
    border: 2px solid #111;
  }

  .field {
    margin: 0.5rem 0;
    display: grid;
    gap: 0.35rem;
  }

  textarea {
    min-height: 88px;
  }

  pre {
    background: #f5f5f5;
    padding: 0.75rem;
    overflow-x: auto;
  }
</style>
`;
};

export const templateUserAppEntry = (): string => `<script lang="ts">
  import AppShell from "./lib/generated/AppShell.svelte";
</script>

<AppShell />
`;

export const templateUIAFiles = (ir: SpecIR): Record<string, string> => {
  const screens = sortedScreens(ir);
  const files: Record<string, string> = {
    "src/lib/screens/generated/index.ts": templateScreensIndex(ir),
    "src/lib/generated/AppShell.svelte": templateAppWithScreensNav(ir),
    "src/App.svelte": templateUserAppEntry()
  };

  screens.forEach((screen) => {
    files[`src/lib/screens/generated/${screen.slug}.svelte`] = templateScreenSvelte(screen);
  });

  return files;
};
