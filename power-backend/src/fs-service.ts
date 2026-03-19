import fs from "node:fs";
import path from "node:path";

export type PowerFsDirectoryEntry = {
  name: string;
  path: string;
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

  private findOwningRoot(candidatePath: string) {
    for (const rootPath of this.roots) {
      if (isInsideRoot(candidatePath, rootPath)) {
        return rootPath;
      }
    }
    throw new Error(`Path is outside allowed roots: ${candidatePath}`);
  }
}
