/**
 * Skill 包结构校验器 — 流水线第 1 阶段。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

// ---------------------------------------------------------------------------
// 限制项
// ---------------------------------------------------------------------------

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 1 * 1024 * 1024;
const MAX_FILE_COUNT = 500;

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type PackageValidationResult = {
  valid: boolean;
  errors: string[];
  extractDir?: string;
  skillMdContent?: string;
};

// ---------------------------------------------------------------------------
// 路径安全检查
// ---------------------------------------------------------------------------

function isPathSafe(base: string, target: string): boolean {
  const resolved = path.resolve(base, target);
  return resolved.startsWith(path.resolve(base) + path.sep) || resolved === path.resolve(base);
}

// ---------------------------------------------------------------------------
// tar/tgz 解压
// ---------------------------------------------------------------------------

async function extractTarArchive(filePath: string, destDir: string): Promise<string[]> {
  const extracted: string[] = [];

  await tar.extract({
    file: filePath,
    cwd: destDir,
    filter: (entryPath, entry) => {
      if (entryPath.includes("..") || path.isAbsolute(entryPath)) return false;
      if (!isPathSafe(destDir, entryPath)) return false;
      if (entry.size !== undefined && entry.size > MAX_SINGLE_FILE_BYTES) return false;
      extracted.push(entryPath);
      return true;
    },
  });

  return extracted;
}

// ---------------------------------------------------------------------------
// zip 解压
// ---------------------------------------------------------------------------

async function extractZip(filePath: string, destDir: string): Promise<string[]> {
  const unzipper = await import("unzipper");
  const extracted: string[] = [];

  const directory = await unzipper.Open.file(filePath);

  for (const file of directory.files) {
    const entryPath = file.path;

    if (entryPath.includes("..") || path.isAbsolute(entryPath)) continue;
    if (!isPathSafe(destDir, entryPath)) continue;

    const destPath = path.join(destDir, entryPath);

    if (file.type === "Directory") {
      await fs.mkdir(destPath, { recursive: true });
    } else {
      if (file.uncompressedSize > MAX_SINGLE_FILE_BYTES) continue;
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await pipeline(file.stream(), createWriteStream(destPath));
      extracted.push(entryPath);
    }
  }

  return extracted;
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

export async function validateAndExtractPackage(
  uploadedFilePath: string,
  mimeType: string,
): Promise<PackageValidationResult> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(uploadedFilePath);
  } catch {
    return { valid: false, errors: ["Uploaded file not found"] };
  }

  if (stat.size > MAX_TOTAL_BYTES) {
    return {
      valid: false,
      errors: [`Package exceeds maximum allowed size of ${MAX_TOTAL_BYTES / 1024 / 1024} MB`],
    };
  }

  const extractDir = await fs.mkdtemp(path.join(process.env.TMP ?? "/tmp", "skillshub-skill-"));

  const isTar =
    mimeType === "application/gzip" ||
    mimeType === "application/x-gzip" ||
    mimeType === "application/x-tar" ||
    mimeType === "application/tar" ||
    uploadedFilePath.endsWith(".tgz") ||
    uploadedFilePath.endsWith(".tar.gz") ||
    uploadedFilePath.endsWith(".tar");

  const isZip =
    mimeType === "application/zip" ||
    mimeType === "application/x-zip-compressed" ||
    uploadedFilePath.endsWith(".zip");

  let extractedPaths: string[] = [];
  try {
    if (isTar) {
      extractedPaths = await extractTarArchive(uploadedFilePath, extractDir);
    } else if (isZip) {
      extractedPaths = await extractZip(uploadedFilePath, extractDir);
    } else {
      await fs.rm(extractDir, { recursive: true, force: true });
      return { valid: false, errors: ["Unsupported package format. Use .tgz, .tar, or .zip"] };
    }
  } catch (err) {
    await fs.rm(extractDir, { recursive: true, force: true });
    return { valid: false, errors: [`Failed to extract package: ${String(err)}`] };
  }

  if (extractedPaths.length > MAX_FILE_COUNT) {
    await fs.rm(extractDir, { recursive: true, force: true });
    return {
      valid: false,
      errors: [`Package contains too many files (max ${MAX_FILE_COUNT})`],
    };
  }

  const skillMdCandidates = [
    path.join(extractDir, "SKILL.md"),
    ...(await findSkillMd(extractDir)),
  ];

  let skillMdPath: string | undefined;
  for (const candidate of skillMdCandidates) {
    try {
      await fs.access(candidate);
      skillMdPath = candidate;
      break;
    } catch {
      // candidate not found
    }
  }

  if (!skillMdPath) {
    await fs.rm(extractDir, { recursive: true, force: true });
    return { valid: false, errors: ["SKILL.md not found in package root"] };
  }

  let skillMdContent: string;
  try {
    skillMdContent = await fs.readFile(skillMdPath, "utf-8");
  } catch {
    await fs.rm(extractDir, { recursive: true, force: true });
    return { valid: false, errors: ["Failed to read SKILL.md"] };
  }

  return { valid: true, errors: [], extractDir, skillMdContent };
}

async function findSkillMd(baseDir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(baseDir, entry.name, "SKILL.md");
        try {
          await fs.access(candidate);
          results.push(candidate);
        } catch {
          // not found in this subdir
        }
      }
    }
  } catch {
    // ignore
  }
  return results;
}
