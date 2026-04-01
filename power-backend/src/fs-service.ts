import fs from "node:fs";
import path from "node:path";

export type PowerFsDirectoryEntry = {
  name: string;
  path: string;
};

export type PowerFsWorkspaceEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  updatedAtMs?: number;
};

export type PowerFsRootsResult = {
  roots: PowerFsDirectoryEntry[];
};

export type PowerFsListResult = {
  path: string;
  name: string;
  parentPath: string | null;
  entries: PowerFsDirectoryEntry[];
};

export type PowerFsWorkspaceListResult = {
  path: string;
  name: string;
  parentPath: string | null;
  entries: PowerFsWorkspaceEntry[];
};

export type PowerFsWorkspaceFileResult = {
  name: string;
  path: string;
  size: number;
  updatedAtMs: number;
  contentBase64: string;
};

type PowerFsWorkspaceEntryCandidate = PowerFsWorkspaceEntry | null;

type PowerFsConfig = {
  roots: string[];
};

function uniquePreserveOrder(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function realpathOrResolved(input: string) {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isInsideRoot(candidatePath: string, rootPath: string) {
  if (candidatePath === rootPath) {
    return true;
  }
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toDirectoryEntry(absolutePath: string): PowerFsDirectoryEntry {
  const name = path.basename(absolutePath) || absolutePath;
  return { name, path: absolutePath };
}

function assertValidLeafName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid name: ${trimmed}`);
  }
  if (trimmed !== path.basename(trimmed)) {
    throw new Error(`Invalid nested name: ${trimmed}`);
  }
  return trimmed;
}

export class PowerFsService {
  private readonly roots: string[];

  constructor(config: PowerFsConfig) {
    const requestedRoots = uniquePreserveOrder(config.roots);
    const resolvedRoots = requestedRoots
      .map((entry) => realpathOrResolved(entry))
      .filter((entry) => {
        try {
          return fs.statSync(entry).isDirectory();
        } catch {
          return false;
        }
      });
    this.roots = resolvedRoots.length > 0 ? resolvedRoots : [realpathOrResolved(process.cwd())];
  }

  listRoots(): PowerFsRootsResult {
    return {
      roots: this.roots.map((rootPath) => toDirectoryEntry(rootPath)),
    };
  }

  validateWorkspace(inputPath: string) {
    const resolvedPath = this.resolveAllowedDirectory(inputPath);
    return {
      ok: true,
      path: resolvedPath,
      name: path.basename(resolvedPath) || resolvedPath,
    };
  }

  listDirs(inputPath?: string | null): PowerFsListResult {
    const currentPath = this.resolveNavigationPath(inputPath);
    const root = this.findOwningRoot(currentPath);
    const directoryEntries = fs.readdirSync(currentPath, { withFileTypes: true });
    const entries = directoryEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const childPath = realpathOrResolved(path.join(currentPath, entry.name));
        if (!isInsideRoot(childPath, root)) {
          return null;
        }
        return {
          name: entry.name,
          path: childPath,
        } satisfies PowerFsDirectoryEntry;
      })
      .filter((entry): entry is PowerFsDirectoryEntry => entry !== null)
      .toSorted((left, right) => left.name.localeCompare(right.name));

    const parentCandidate = realpathOrResolved(path.dirname(currentPath));
    const parentPath =
      currentPath !== root && isInsideRoot(parentCandidate, root) ? parentCandidate : null;

    return {
      path: currentPath,
      name: path.basename(currentPath) || currentPath,
      parentPath,
      entries,
    };
  }

  createDirectory(currentPath: string, name: string): PowerFsDirectoryEntry {
    const baseDir = this.resolveAllowedDirectory(currentPath);
    const folderName = assertValidLeafName(name);
    const nextPath = path.resolve(baseDir, folderName);
    const root = this.findOwningRoot(baseDir);
    if (!isInsideRoot(nextPath, root)) {
      throw new Error(`Path is outside allowed roots: ${nextPath}`);
    }
    fs.mkdirSync(nextPath, { recursive: false });
    return toDirectoryEntry(nextPath);
  }

  listWorkspaceEntries(
    workspaceDir: string,
    inputPath?: string | null,
  ): PowerFsWorkspaceListResult {
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceDir);
    const currentPath = inputPath?.trim()
      ? this.resolveWorkspaceDirectory(workspaceRoot, inputPath)
      : workspaceRoot;
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .map<PowerFsWorkspaceEntryCandidate>((entry) => {
        const entryPath = path.resolve(currentPath, entry.name);
        if (!this.isWithinRoot(entryPath, workspaceRoot)) {
          return null;
        }
        let stats: fs.Stats | null = null;
        try {
          stats = fs.statSync(entryPath);
        } catch {
          stats = null;
        }
        const kind = entry.isDirectory() ? "directory" : "file";
        return {
          name: entry.name,
          path: entryPath,
          kind,
          size: kind === "file" ? (stats?.size ?? 0) : undefined,
          updatedAtMs: stats ? Math.floor(stats.mtimeMs) : undefined,
        } satisfies PowerFsWorkspaceEntry;
      })
      .filter((entry): entry is PowerFsWorkspaceEntry => entry !== null)
      .toSorted((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    const parentCandidate = path.dirname(currentPath);
    const parentPath =
      currentPath !== workspaceRoot && this.isWithinRoot(parentCandidate, workspaceRoot)
        ? parentCandidate
        : null;

    return {
      path: currentPath,
      name: path.basename(currentPath) || currentPath,
      parentPath,
      entries,
    };
  }

  createWorkspaceDirectory(workspaceDir: string, currentPath: string | null, name: string) {
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceDir);
    const baseDir = currentPath?.trim()
      ? this.resolveWorkspaceDirectory(workspaceRoot, currentPath)
      : workspaceRoot;
    const folderName = assertValidLeafName(name);
    const nextPath = path.resolve(baseDir, folderName);
    if (!this.isWithinRoot(nextPath, workspaceRoot)) {
      throw new Error(`Path is outside workspace: ${nextPath}`);
    }
    fs.mkdirSync(nextPath, { recursive: false });
    const stats = fs.statSync(nextPath);
    return {
      name: folderName,
      path: nextPath,
      kind: "directory" as const,
      updatedAtMs: Math.floor(stats.mtimeMs),
    } satisfies PowerFsWorkspaceEntry;
  }

  writeWorkspaceFile(
    workspaceDir: string,
    currentPath: string | null,
    fileName: string,
    contentBase64: string,
  ) {
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceDir);
    const baseDir = currentPath?.trim()
      ? this.resolveWorkspaceDirectory(workspaceRoot, currentPath)
      : workspaceRoot;
    const safeName = assertValidLeafName(fileName);
    const nextPath = path.resolve(baseDir, safeName);
    if (!this.isWithinRoot(nextPath, workspaceRoot)) {
      throw new Error(`Path is outside workspace: ${nextPath}`);
    }
    const buffer = Buffer.from(contentBase64, "base64");
    fs.writeFileSync(nextPath, buffer);
    const stats = fs.statSync(nextPath);
    return {
      name: safeName,
      path: nextPath,
      kind: "file" as const,
      size: stats.size,
      updatedAtMs: Math.floor(stats.mtimeMs),
    } satisfies PowerFsWorkspaceEntry;
  }

  readWorkspaceFile(workspaceDir: string, inputPath: string): PowerFsWorkspaceFileResult {
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceDir);
    const filePath = this.resolveWorkspaceFile(workspaceRoot, inputPath);
    const buffer = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    return {
      name: path.basename(filePath) || filePath,
      path: filePath,
      size: stats.size,
      updatedAtMs: Math.floor(stats.mtimeMs),
      contentBase64: buffer.toString("base64"),
    };
  }

  deleteWorkspaceEntry(workspaceDir: string, inputPath: string) {
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceDir);
    const targetPath = this.resolveWorkspacePath(workspaceRoot, inputPath);
    const stats = fs.statSync(targetPath);
    fs.rmSync(targetPath, { recursive: stats.isDirectory(), force: false });
    return {
      ok: true,
      path: targetPath,
      kind: stats.isDirectory() ? ("directory" as const) : ("file" as const),
    };
  }

  private resolveNavigationPath(inputPath?: string | null) {
    if (!inputPath?.trim()) {
      return this.roots[0];
    }
    return this.resolveAllowedDirectory(inputPath);
  }

  private resolveAllowedDirectory(inputPath: string) {
    const resolvedPath = realpathOrResolved(inputPath);
    const root = this.findOwningRoot(resolvedPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (error) {
      throw new Error(
        `Directory not found: ${resolvedPath} (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedPath}`);
    }
    if (!isInsideRoot(resolvedPath, root)) {
      throw new Error(`Path is outside allowed roots: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private resolveWorkspaceRoot(workspaceDir: string) {
    const resolvedPath = realpathOrResolved(workspaceDir);
    let stats: fs.Stats;
    try {
      stats = fs.statSync(resolvedPath);
    } catch (error) {
      throw new Error(
        `Workspace not found: ${resolvedPath} (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }
    if (!stats.isDirectory()) {
      throw new Error(`Workspace is not a directory: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private resolveWorkspaceDirectory(workspaceRoot: string, inputPath: string) {
    const resolvedPath = this.resolveWorkspacePath(workspaceRoot, inputPath);
    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private resolveWorkspaceFile(workspaceRoot: string, inputPath: string) {
    const resolvedPath = this.resolveWorkspacePath(workspaceRoot, inputPath);
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private resolveWorkspacePath(workspaceRoot: string, inputPath: string) {
    const trimmed = inputPath.trim();
    if (!trimmed) {
      throw new Error("Path is required.");
    }
    const resolvedPath = realpathOrResolved(trimmed);
    if (!this.isWithinRoot(resolvedPath, workspaceRoot)) {
      throw new Error(`Path is outside workspace: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private isWithinRoot(candidatePath: string, rootPath: string) {
    return isInsideRoot(candidatePath, rootPath);
  }

  private findOwningRoot(candidatePath: string) {
    for (const rootPath of this.roots) {
      if (isInsideRoot(candidatePath, rootPath)) {
        return rootPath;
      }
    }
    throw new Error(`Path is outside allowed roots: ${candidatePath}`);
  }
}
