import type { SpecIR } from "../../spec/schema.js";
import { bindActionToCommand, buildActionId } from "./bindings.js";
import { toScreenSlug } from "./slug.js";

type ActionDef = {
  id: string;
  label: string;
  boundCommand: string | null;
};

type ScreenDef = {
  name: string;
  purpose: string;
  slug: string;
  primaryActions: string[];
  actions: ActionDef[];
};

const escapeText = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const sortedScreens = (ir: SpecIR): ScreenDef[] => {
  const commandNames = [...ir.rust_commands].map((cmd) => cmd.name);

  return [...ir.screens]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((screen) => {
      const primaryActions = [...screen.primary_actions];
      const actions = primaryActions.map((label) => ({
        id: buildActionId(screen.name, label),
        label,
        boundCommand: bindActionToCommand(label, commandNames)
      }));

      return {
        name: screen.name,
        purpose: screen.purpose ?? "",
        slug: toScreenSlug(screen.name),
        primaryActions,
        actions
      };
    });
};

export const templateFieldForm = (): string => `<script lang="ts">
  export let schema: Record<string, string> = {};
  export let value: Record<string, unknown> = {};

  let errors: Record<string, string> = {};

  const parseType = (rawType: string): { type: string; optional: boolean } => {
    const normalized = rawType.trim().toLowerCase();
    if (normalized.endsWith("?")) {
      return { type: normalized.slice(0, -1), optional: true };
    }
    return { type: normalized, optional: false };
  };

  const sortedEntries = (): Array<[string, string]> =>
    Object.entries(schema).sort(([left], [right]) => left.localeCompare(right));

  const setField = (name: string, nextValue: unknown): void => {
    value = { ...value, [name]: nextValue };
  };

  export const buildPayload = (): { ok: boolean; payload: Record<string, unknown>; errors: Record<string, string> } => {
    const payload: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};

    for (const [field, rawType] of sortedEntries()) {
      const { type, optional } = parseType(rawType);
      const rawValue = value[field];

      if (type === "boolean") {
        if (rawValue === undefined && optional) continue;
        payload[field] = Boolean(rawValue);
        continue;
      }

      const text = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
      if (optional && text.trim() === "") {
        continue;
      }

      if (type === "int" || type === "float") {
        const num = Number(text);
        if (Number.isNaN(num)) {
          nextErrors[field] = "Invalid number";
          continue;
        }
        payload[field] = num;
        continue;
      }

      if (type === "json") {
        if (optional && text.trim() === "") {
          continue;
        }
        try {
          payload[field] = JSON.parse(text);
        } catch {
          nextErrors[field] = "Invalid JSON";
        }
        continue;
      }

      payload[field] = text;
    }

    errors = nextErrors;
    return { ok: Object.keys(nextErrors).length === 0, payload, errors: nextErrors };
  };
</script>

<div class="field-form">
  {#each Object.entries(schema).sort((a, b) => a[0].localeCompare(b[0])) as [field, rawType]}
    {@const parsed = parseType(rawType)}
    <div class="field-row">
      <label>{field} ({rawType})</label>
      {#if parsed.type === "boolean"}
        <input
          type="checkbox"
          checked={Boolean(value[field])}
          on:change={(event) => {
            const target = event.currentTarget as HTMLInputElement;
            setField(field, target.checked);
          }}
        />
      {:else if parsed.type === "json"}
        <textarea
          value={String(value[field] ?? "")}
          on:input={(event) => {
            const target = event.currentTarget as HTMLTextAreaElement;
            setField(field, target.value);
          }}
        ></textarea>
      {:else if parsed.type === "int" || parsed.type === "float"}
        <input
          type="number"
          value={String(value[field] ?? "")}
          on:input={(event) => {
            const target = event.currentTarget as HTMLInputElement;
            setField(field, target.value);
          }}
        />
      {:else}
        <input
          type="text"
          value={String(value[field] ?? "")}
          on:input={(event) => {
            const target = event.currentTarget as HTMLInputElement;
            setField(field, target.value);
          }}
        />
      {/if}
      {#if errors[field]}
        <p class="error">{errors[field]}</p>
      {/if}
    </div>
  {/each}
</div>

<style>
  .field-form {
    display: grid;
    gap: 0.5rem;
  }

  .field-row {
    display: grid;
    gap: 0.25rem;
  }

  textarea {
    min-height: 84px;
  }

  .error {
    color: #b42318;
    margin: 0;
  }
</style>
`;

export const templateActionRunner = (): string => `<script lang="ts">
  import FieldForm from "./FieldForm.svelte";
  import { callCommand, commandMetas, type ApiResponse } from "../../api/generated/commands";

  export let actionLabel: string;
  export let boundCommand: string | null;

  let selectedCommand = boundCommand ?? commandMetas[0]?.name ?? "";
  let value: Record<string, unknown> = {};
  let runResult = "";
  let runError = "";
  let loading = false;

  let formRef: { buildPayload: () => { ok: boolean; payload: Record<string, unknown>; errors: Record<string, string> } } | null =
    null;

  const selectedMeta = () => commandMetas.find((meta) => meta.name === selectedCommand) ?? null;

  const resetForm = () => {
    value = {};
    const meta = selectedMeta();
    if (!meta) return;

    for (const [field, rawType] of Object.entries(meta.input)) {
      const normalized = rawType.toLowerCase().replace(/\\?$/, "");
      value[field] = normalized === "boolean" ? false : "";
    }
  };

  $: if (boundCommand && selectedCommand !== boundCommand) {
    selectedCommand = boundCommand;
    resetForm();
  }

  const run = async () => {
    runError = "";
    runResult = "";
    loading = true;

    try {
      if (!selectedCommand) {
        throw new Error("Please select a command");
      }
      if (!formRef) {
        throw new Error("Form not ready");
      }

      const parsed = formRef.buildPayload();
      if (!parsed.ok) {
        throw new Error("Form validation failed");
      }

      const response: ApiResponse<unknown> = await callCommand(selectedCommand, parsed.payload);
      runResult = JSON.stringify(response, null, 2);
      if (!response.ok) {
        runError = response.error.detail ? response.error.message + ": " + response.error.detail : response.error.message;
      }
    } catch (err) {
      runError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      loading = false;
    }
  };
</script>

<div class="action-runner">
  <h3>{actionLabel}</h3>

  {#if boundCommand === null}
    <label>
      Command
      <select bind:value={selectedCommand} on:change={resetForm}>
        {#each commandMetas as meta}
          <option value={meta.name}>{meta.name}</option>
        {/each}
      </select>
    </label>
  {:else}
    <p>Bound command: <code>{boundCommand}</code></p>
  {/if}

  {#if selectedMeta()}
    <FieldForm bind:this={formRef} schema={selectedMeta()!.input} bind:value />
  {:else}
    <p>No command metadata available.</p>
  {/if}

  <button on:click={run} disabled={loading}>{loading ? "Running..." : "Run"}</button>

  {#if runError}
    <p class="error">{runError}</p>
  {/if}
  {#if runResult}
    <pre>{runResult}</pre>
  {/if}
</div>

<style>
  .action-runner {
    border: 1px solid #e5e7eb;
    padding: 0.75rem;
    margin: 0.75rem 0;
    display: grid;
    gap: 0.5rem;
  }

  .error {
    color: #b42318;
    margin: 0;
  }

  pre {
    background: #f5f5f5;
    padding: 0.75rem;
    overflow-x: auto;
  }
</style>
`;

const templateScreensIndexWithBindings = (ir: SpecIR): string => {
  const screens = sortedScreens(ir);

  const rows = screens
    .map((screen) => {
      const primaryActions = screen.primaryActions.map((action) => `"${escapeText(action)}"`).join(", ");
      const actions = screen.actions
        .map(
          (action) => `      {
        id: "${escapeText(action.id)}",
        label: "${escapeText(action.label)}",
        bound_command: ${action.boundCommand ? `"${escapeText(action.boundCommand)}"` : "null"}
      }`
        )
        .join(",\n");

      return `  {
    name: "${escapeText(screen.name)}",
    purpose: "${escapeText(screen.purpose)}",
    slug: "${screen.slug}",
    primary_actions: [${primaryActions}],
    actions: [
${actions}
    ]
  }`;
    })
    .join(",\n");

  return `export type ActionMeta = {
  id: string;
  label: string;
  bound_command: string | null;
};

export type ScreenMeta = {
  name: string;
  purpose: string;
  slug: string;
  primary_actions: string[];
  actions: ActionMeta[];
};

export const screens: ScreenMeta[] = [
${rows}
];
`;
};

const templateScreenWithRunner = (screen: ScreenDef): string => {
  const actionsRows = screen.actions
    .map(
      (action) => `  {
    id: "${escapeText(action.id)}",
    label: "${escapeText(action.label)}",
    bound_command: ${action.boundCommand ? `"${escapeText(action.boundCommand)}"` : "null"}
  }`
    )
    .join(",\n");

  return `<script lang="ts">
  import ActionRunner from "../../components/generated/ActionRunner.svelte";

  const name = "${escapeText(screen.name)}";
  const purpose = "${escapeText(screen.purpose)}";
  const actions = [
${actionsRows}
  ];
</script>

<section>
  <h1>{name}</h1>
  <p>{purpose}</p>

  <h2>Primary Actions</h2>
  {#if actions.length === 0}
    <p>No primary actions defined.</p>
  {:else}
    {#each actions as action}
      <ActionRunner actionLabel={action.label} boundCommand={action.bound_command} />
    {/each}
  {/if}
</section>
`;
};

export const templateUIBFiles = (ir: SpecIR): Record<string, string> => {
  const screens = sortedScreens(ir);
  const files: Record<string, string> = {
    "src/lib/components/generated/FieldForm.svelte": templateFieldForm(),
    "src/lib/components/generated/ActionRunner.svelte": templateActionRunner(),
    "src/lib/screens/generated/index.ts": templateScreensIndexWithBindings(ir)
  };

  screens.forEach((screen) => {
    files[`src/lib/screens/generated/${screen.slug}.svelte`] = templateScreenWithRunner(screen);
  });

  return files;
};
