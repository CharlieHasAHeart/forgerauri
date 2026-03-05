import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { rm } from "node:fs/promises";
import type { AgentState } from "../../core/contracts/state.js";
import type { ToolResult, ToolRunContext, ToolSpec } from "../../core/contracts/tools.js";
import { storeBlob } from "../../core/utils/blobStore.js";

type EditCreate = { kind: "create_file"; path: string; content: string };
type EditDelete = { kind: "delete_file"; path: string };
type EditReplaceRange = { kind: "replace_range"; path: string; startLine: number; endLine: number; replacement: string };
type EditFindReplace = { kind: "find_replace"; path: string; find: string; replace: string };
type EditInsertAfter = { kind: "insert_after"; path: string; line: number; content: string };
type StructuredEdit = EditCreate | EditDelete | EditReplaceRange | EditFindReplace | EditInsertAfter;

type ToolInput = {
  cwd?: string;
  checkOnly?: boolean;
  reject?: boolean;
  edits: StructuredEdit[];
};

type FileChange = {
  relPath: string;
  absolutePath: string;
  oldContent: string;
  newContent: string;
  existedBefore: boolean;
  deleteAfter: boolean;
};

const normalizePath = (value: string): string => value.replace(/\\/g, "/");

const parseInput = (value: unknown): ToolInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("input must be object");
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.edits)) throw new Error("input.edits must be array");

  const edits: StructuredEdit[] = obj.edits.map((raw, idx) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`edits[${idx}] must be object`);
    const item = raw as Record<string, unknown>;
    const kind = typeof item.kind === "string" ? item.kind : "";
    const path = typeof item.path === "string" && item.path.trim() ? normalizePath(item.path.trim()) : "";
    if (!path) throw new Error(`edits[${idx}].path must be non-empty string`);

    if (kind === "create_file") {
      if (typeof item.content !== "string") throw new Error(`edits[${idx}].content must be string`);
      return { kind, path, content: item.content };
    }
    if (kind === "delete_file") return { kind, path };
    if (kind === "replace_range") {
      if (typeof item.replacement !== "string") throw new Error(`edits[${idx}].replacement must be string`);
      if (typeof item.startLine !== "number" || typeof item.endLine !== "number") throw new Error(`edits[${idx}] invalid start/end`);
      return { kind, path, startLine: Math.floor(item.startLine), endLine: Math.floor(item.endLine), replacement: item.replacement };
    }
    if (kind === "find_replace") {
      if (typeof item.find !== "string" || typeof item.replace !== "string") throw new Error(`edits[${idx}] invalid find/replace`);
      return { kind, path, find: item.find, replace: item.replace };
    }
    if (kind === "insert_after") {
      if (typeof item.line !== "number" || typeof item.content !== "string") throw new Error(`edits[${idx}] invalid line/content`);
      return { kind, path, line: Math.floor(item.line), content: item.content };
    }
    throw new Error(`edits[${idx}] unsupported kind '${kind}'`);
  });

  return {
    cwd: typeof obj.cwd === "string" && obj.cwd.trim() ? obj.cwd.trim() : undefined,
    checkOnly: obj.checkOnly === true,
    reject: obj.reject === true,
    edits
  };
};

const safeResolve = (baseDir: string, target: string): string => {
  const normalized = normalizePath(target);
  const absolute = isAbsolute(normalized) ? resolve(normalized) : resolve(baseDir, normalized);
  const rel = normalizePath(relative(baseDir, absolute));
  if (rel === ".." || rel.startsWith("../")) throw new Error(`path escapes base dir: ${target}`);
  return absolute;
};

const run = (ctx: ToolRunContext, cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> =>
  ctx.runCmdImpl(cmd, args, cwd);

const ensurePatchPaths = (ctx: ToolRunContext): string[] => {
  if (!Array.isArray(ctx.memory.patchPaths)) ctx.memory.patchPaths = [];
  return ctx.memory.patchPaths;
};

const readUtf8IfExists = async (file: string): Promise<{ exists: boolean; content: string }> => {
  try {
    const content = await readFile(file, "utf8");
    return { exists: true, content };
  } catch {
    return { exists: false, content: "" };
  }
};

const applyEdit = (content: string, edit: StructuredEdit): { next: string; deleteAfter: boolean } => {
  if (edit.kind === "create_file") return { next: edit.content, deleteAfter: false };
  if (edit.kind === "delete_file") return { next: "", deleteAfter: true };
  if (edit.kind === "find_replace") {
    if (!content.includes(edit.find)) throw new Error(`find_replace target not found: ${edit.path}`);
    return { next: content.replace(edit.find, edit.replace), deleteAfter: false };
  }
  if (edit.kind === "replace_range") {
    if (edit.startLine < 1 || edit.endLine < edit.startLine) throw new Error(`replace_range invalid lines for ${edit.path}`);
    const lines = content.split(/\r?\n/);
    if (lines.length > 0 && edit.startLine > lines.length) throw new Error(`replace_range start exceeds file length for ${edit.path}`);
    const start = Math.max(1, edit.startLine);
    const end = Math.min(Math.max(start, edit.endLine), Math.max(lines.length, start));
    lines.splice(start - 1, end - start + 1, ...edit.replacement.split(/\r?\n/));
    return { next: lines.join("\n"), deleteAfter: false };
  }
  if (edit.kind === "insert_after") {
    if (edit.line < 0) throw new Error(`insert_after line must be >= 0 for ${edit.path}`);
    const lines = content.split(/\r?\n/);
    if (edit.line > lines.length) throw new Error(`insert_after line exceeds file length for ${edit.path}`);
    lines.splice(edit.line, 0, ...edit.content.split(/\r?\n/));
    return { next: lines.join("\n"), deleteAfter: false };
  }
  return { next: content, deleteAfter: false };
};

const ensureGitBaseline = async (ctx: ToolRunContext, baseDir: string): Promise<void> => {
  try {
    await stat(join(baseDir, ".git"));
    return;
  } catch {
    // continue
  }
  const steps: Array<{ cmd: string; args: string[] }> = [
    { cmd: "git", args: ["init"] },
    { cmd: "git", args: ["add", "-A"] },
    {
      cmd: "git",
      args: ["-c", "user.email=bot@example.com", "-c", "user.name=bot", "commit", "-m", "baseline", "--allow-empty"]
    }
  ];
  for (const step of steps) {
    const result = await run(ctx, step.cmd, step.args, baseDir);
    if (step.args[0] === "-c" && result.code !== 0) {
      const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
      if (text.includes("nothing to commit")) return;
    }
    if (result.code !== 0 || !result.ok) {
      throw new Error(`${step.cmd} ${step.args.join(" ")} failed: ${result.stderr || result.stdout || result.code}`);
    }
  }
};

const createUnifiedDiff = async (args: {
  ctx: ToolRunContext;
  baseDir: string;
  relPath: string;
  oldContent: string;
  newContent: string;
  existedBefore: boolean;
  deleteAfter: boolean;
}): Promise<string> => {
  if (!args.existedBefore && !args.deleteAfter) {
    const lines = args.newContent.split(/\r?\n/);
    const payload = lines.filter((_, idx) => !(idx === lines.length - 1 && lines[idx] === ""));
    const hunk = payload.map((line) => `+${line}`).join("\n");
    return [
      `diff --git a/${args.relPath} b/${args.relPath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${args.relPath}`,
      `@@ -0,0 +1,${payload.length} @@`,
      hunk
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  if (args.existedBefore && args.deleteAfter) {
    const lines = args.oldContent.split(/\r?\n/);
    const payload = lines.filter((_, idx) => !(idx === lines.length - 1 && lines[idx] === ""));
    const hunk = payload.map((line) => `-${line}`).join("\n");
    return [
      `diff --git a/${args.relPath} b/${args.relPath}`,
      "deleted file mode 100644",
      `--- a/${args.relPath}`,
      "+++ /dev/null",
      `@@ -1,${payload.length} +0,0 @@`,
      hunk
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  const temp = await mkdtemp(join(tmpdir(), "structured-edit-"));
  const oldPath = join(temp, "old.txt");
  const newPath = join(temp, "new.txt");
  try {
    await writeFile(oldPath, args.oldContent, "utf8");
    await writeFile(newPath, args.deleteAfter ? "" : args.newContent, "utf8");
    const diff = await run(args.ctx, "git", ["diff", "--no-index", "--no-color", "--", oldPath, newPath], args.baseDir);
    if (diff.code > 1 || (!diff.ok && diff.code !== 1)) {
      throw new Error(diff.stderr || diff.stdout || `git diff failed with ${diff.code}`);
    }
    const lines = `${diff.stdout ?? ""}${diff.stderr ?? ""}`.split(/\r?\n/);
    const normalized = lines.map((line) => {
      if (line.startsWith("diff --git ")) return `diff --git a/${args.relPath} b/${args.relPath}`;
      if (line.startsWith("--- ")) return `--- a/${args.relPath}`;
      if (line.startsWith("+++ ")) return `+++ b/${args.relPath}`;
      return line;
    });
    return normalized.join("\n");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

const buildPatchText = async (args: { ctx: ToolRunContext; baseDir: string; changes: FileChange[] }): Promise<string> => {
  const chunks: string[] = [];
  for (const change of args.changes) {
    const diff = await createUnifiedDiff({
      ctx: args.ctx,
      baseDir: args.baseDir,
      relPath: change.relPath,
      oldContent: change.oldContent,
      newContent: change.newContent,
      existedBefore: change.existedBefore,
      deleteAfter: change.deleteAfter
    });
    if (diff) chunks.push(diff);
  }
  return `${chunks.join("\n\n")}\n`;
};

const getStateFromMemory = (ctx: ToolRunContext): AgentState | undefined => {
  const candidate = ctx.memory.agentState;
  if (!candidate || typeof candidate !== "object") return undefined;
  return candidate as AgentState;
};

export const createApplyStructuredEditsTool = (): ToolSpec<ToolInput> => ({
  name: "apply_structured_edits",
  description: "Generate unified patch from structured edits, check/apply via git apply, and record patch artifacts.",
  inputSchema: { parse: parseInput },
  async run(input, ctx): Promise<ToolResult> {
    const state = getStateFromMemory(ctx);
    const runDir = ctx.memory.runDir ?? state?.runDir ?? process.cwd();
    const appDir = ctx.memory.appDir ?? state?.appDir;
    const baseDir = resolve(input.cwd ?? appDir ?? runDir);
    const files = new Map<string, FileChange>();

    try {
      for (const edit of input.edits) {
        const absolutePath = safeResolve(baseDir, edit.path);
        const relPath = normalizePath(relative(baseDir, absolutePath));
        let target = files.get(relPath);
        if (!target) {
          const existing = await readUtf8IfExists(absolutePath);
          target = {
            relPath,
            absolutePath,
            oldContent: existing.content,
            newContent: existing.content,
            existedBefore: existing.exists,
            deleteAfter: false
          };
          files.set(relPath, target);
        }
        const applied = applyEdit(target.newContent, edit);
        target.newContent = applied.next;
        target.deleteAfter = applied.deleteAfter;
      }

      const changes = [...files.values()];
      const patchText = await buildPatchText({ ctx, baseDir, changes });
      const patchRef = storeBlob(ctx, patchText, "patch");
      const patchDir = join(runDir, "patches");
      await mkdir(patchDir, { recursive: true });
      const seq = String((ensurePatchPaths(ctx).length ?? 0) + 1).padStart(4, "0");
      const turn = state?.budgets.usedTurns ?? 0;
      const taskId = state?.currentTaskId ?? "unknown";
      const patchPath = join(patchDir, `turn-${turn}-task-${taskId}-${seq}.patch`);
      await writeFile(patchPath, patchText, "utf8");
      const patchPaths = ensurePatchPaths(ctx);
      if (!patchPaths.includes(patchPath)) patchPaths.push(patchPath);

      try {
        await ensureGitBaseline(ctx, baseDir);
      } catch (error) {
        const stderrRef = storeBlob(ctx, String(error), "stderr");
        return {
          ok: false,
          error: {
            code: "PATCH_BASELINE_INIT_FAILED",
            message: error instanceof Error ? error.message : String(error),
            detail: stderrRef
          }
        };
      }

      const check = await run(ctx, "git", ["apply", "--check", patchPath], baseDir);
      if (check.code !== 0 || !check.ok) {
        const stdoutRef = storeBlob(ctx, check.stdout ?? "", "stdout");
        const stderrRef = storeBlob(ctx, check.stderr ?? "", "stderr");
        return {
          ok: false,
          data: {
            ok: false,
            applied: false,
            patchRef,
            patchPath,
            changedFiles: changes.map((c) => c.relPath),
            stdoutRef,
            stderrRef
          },
          error: {
            code: "PATCH_APPLY_CHECK_FAILED",
            message: (check.stderr || check.stdout || "git apply --check failed").trim(),
            detail: stderrRef
          }
        };
      }

      if (input.checkOnly) {
        return {
          ok: true,
          data: {
            ok: true,
            applied: false,
            patchRef,
            patchPath,
            changedFiles: changes.map((c) => c.relPath)
          },
          meta: { touchedPaths: changes.map((c) => c.relPath) }
        };
      }

      const applyArgs = input.reject ? ["apply", "--reject", patchPath] : ["apply", patchPath];
      const apply = await run(ctx, "git", applyArgs, baseDir);
      if (apply.code !== 0 || !apply.ok) {
        const stdoutRef = storeBlob(ctx, apply.stdout ?? "", "stdout");
        const stderrRef = storeBlob(ctx, apply.stderr ?? "", "stderr");
        return {
          ok: false,
          data: {
            ok: false,
            applied: false,
            patchRef,
            patchPath,
            changedFiles: changes.map((c) => c.relPath),
            stdoutRef,
            stderrRef
          },
          error: {
            code: "PATCH_APPLY_FAILED",
            message: (apply.stderr || apply.stdout || "git apply failed").trim(),
            detail: stderrRef
          },
          meta: { touchedPaths: changes.map((c) => c.relPath) }
        };
      }

      return {
        ok: true,
        data: {
          ok: true,
          applied: true,
          patchRef,
          patchPath,
          changedFiles: changes.map((c) => c.relPath)
        },
        meta: { touchedPaths: changes.map((c) => c.relPath) }
      };
    } catch (error) {
      const stderrRef = storeBlob(ctx, error instanceof Error ? error.stack ?? error.message : String(error), "stderr");
      return {
        ok: false,
        error: {
          code: "PATCH_DIFF_FAILED",
          message: error instanceof Error ? error.message : String(error),
          detail: stderrRef
        }
      };
    }
  }
});
