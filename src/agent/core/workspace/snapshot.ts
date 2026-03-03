import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { normalizePath } from "../runtime_paths/path_normalizer.js";

export type SnapshotFileInfo = {
  exists: boolean;
  size?: number;
  sha256?: string;
};

export type WorkspaceSnapshot = {
  rootDir: string;
  exists: (path: string) => boolean;
  fileInfo: (path: string) => SnapshotFileInfo;
};

const sha256 = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

export const createSnapshot = async (
  rootDir: string,
  args?: { paths?: string[] }
): Promise<WorkspaceSnapshot> => {
  const infos = new Map<string, SnapshotFileInfo>();
  const requested = (args?.paths ?? []).map((value) => normalizePath(value).canonical);
  const uniquePaths = Array.from(new Set(requested));

  for (const path of uniquePaths) {
    const absolute = join(rootDir, path);
    try {
      const s = await stat(absolute);
      if (!s.isFile()) {
        infos.set(path, { exists: false });
        continue;
      }
      const content = await readFile(absolute);
      infos.set(path, {
        exists: true,
        size: s.size,
        sha256: sha256(content)
      });
    } catch {
      infos.set(path, { exists: false });
    }
  }

  const fileInfo = (path: string): SnapshotFileInfo => {
    const canonical = normalizePath(path).canonical;
    return infos.get(canonical) ?? { exists: false };
  };

  return {
    rootDir,
    exists: (path: string) => fileInfo(path).exists,
    fileInfo
  };
};
