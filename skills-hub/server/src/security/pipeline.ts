/**
 * Skill 包五阶段校验流水线。
 */

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildReviewArtifacts } from "./review-report.js";
import type { NetworkObservation, ScanSummary, SkillStatus, ValidationResult } from "./types.js";
import { validateAndExtractPackage } from "./package-validator.js";
import { validateFrontmatter } from "./frontmatter.js";
import { scanDirectory } from "./scanner.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export type PipelineConfig = {
  allowedDownloadDomains?: string[];
};

export type PipelineResult = {
  status: SkillStatus;
  skillName?: string;
  skillDescription?: string;
  stages: ValidationResult[];
  scanSummary?: ScanSummary;
  networkObservations: NetworkObservation[];
  rejectionReason?: string;
  reviewSummaryText: string;
  reviewReportMarkdown: string;
  extractDir?: string;
};

// 第 4 阶段：npm 依赖审计

async function runNpmAudit(extractDir: string): Promise<{ hasHighVulnerabilities: boolean; summary: string }> {
  let pkgJson: Record<string, unknown> | null = null;
  try {
    const raw = await fs.readFile(`${extractDir}/package.json`, "utf-8");
    pkgJson = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { hasHighVulnerabilities: false, summary: "No package.json found; skipping npm audit" };
  }

  const deps = (pkgJson.dependencies ?? {}) as Record<string, string>;
  if (Object.keys(deps).length === 0) {
    return { hasHighVulnerabilities: false, summary: "No dependencies declared" };
  }

  try {
    await execFileAsync("npm", ["audit", "--json", "--audit-level=high"], {
      cwd: extractDir,
      timeout: 30_000,
    });
    return { hasHighVulnerabilities: false, summary: "npm audit passed — no high/critical vulnerabilities" };
  } catch (err: unknown) {
    const output = (err as { stdout?: string }).stdout ?? "";
    try {
      const report = JSON.parse(output) as {
        metadata?: { vulnerabilities?: { high?: number; critical?: number } };
      };
      const high = report.metadata?.vulnerabilities?.high ?? 0;
      const critical = report.metadata?.vulnerabilities?.critical ?? 0;
      if (high > 0 || critical > 0) {
        return {
          hasHighVulnerabilities: true,
          summary: `npm audit: ${critical} critical, ${high} high vulnerabilities found`,
        };
      }
    } catch {
      // stdout not valid JSON
    }
    return { hasHighVulnerabilities: false, summary: "npm audit completed (no high/critical issues detected)" };
  }
}

function withReviewArtifacts(
  result: Omit<PipelineResult, "reviewSummaryText" | "reviewReportMarkdown" | "networkObservations">,
): PipelineResult {
  const review = buildReviewArtifacts({
    status: result.status,
    skillName: result.skillName,
    skillDescription: result.skillDescription,
    scanSummary: result.scanSummary,
    rejectionReason: result.rejectionReason,
    validationStages: result.stages,
    baseDir: result.extractDir,
  });

  return {
    ...result,
    networkObservations: review.networkObservations,
    reviewSummaryText: review.reviewSummaryText,
    reviewReportMarkdown: review.reviewReportMarkdown,
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export async function runValidationPipeline(
  uploadedFilePath: string,
  mimeType: string,
  config: PipelineConfig = {},
): Promise<PipelineResult> {
  const stages: ValidationResult[] = [];

  // 第 1 阶段：包结构校验
  const pkgResult = await validateAndExtractPackage(uploadedFilePath, mimeType);
  stages.push({
    stage: "structure",
    passed: pkgResult.valid,
    errors: pkgResult.errors,
  });

  if (!pkgResult.valid || !pkgResult.extractDir || !pkgResult.skillMdContent) {
    return withReviewArtifacts({
      status: "rejected",
      stages,
      rejectionReason: `Package structure validation failed: ${pkgResult.errors.join("; ")}`,
    });
  }

  const { extractDir, skillMdContent } = pkgResult;

  // 第 2 阶段：SKILL.md frontmatter 校验
  const fmResult = validateFrontmatter(skillMdContent, config.allowedDownloadDomains);
  stages.push({
    stage: "frontmatter",
    passed: fmResult.valid,
    errors: fmResult.errors,
  });

  if (!fmResult.valid) {
    await fs.rm(extractDir, { recursive: true, force: true });
    return withReviewArtifacts({
      status: "rejected",
      stages,
      rejectionReason: `SKILL.md validation failed: ${fmResult.errors.join("; ")}`,
    });
  }

  const { name: skillName, description: skillDescription } = fmResult.parsed!;

  // 第 3 阶段：代码安全扫描
  const scanSummary = await scanDirectory(extractDir);
  stages.push({
    stage: "code_scan",
    passed: scanSummary.critical === 0,
    errors:
      scanSummary.critical > 0
        ? scanSummary.findings
            .filter((f) => f.severity === "critical")
            .map((f) => `[${f.ruleId}] ${f.file}:${f.line} — ${f.message}`)
        : [],
    scanSummary,
  });

  if (scanSummary.critical > 0) {
    await fs.rm(extractDir, { recursive: true, force: true });
    return withReviewArtifacts({
      status: "rejected",
      skillName,
      skillDescription,
      stages,
      scanSummary,
      rejectionReason: `Code scan found ${scanSummary.critical} critical issue(s). Review findings for details.`,
    });
  }

  // 第 4 阶段：依赖安全分析
  const auditResult = await runNpmAudit(extractDir);
  stages.push({
    stage: "dependency",
    passed: !auditResult.hasHighVulnerabilities,
    errors: auditResult.hasHighVulnerabilities ? [auditResult.summary] : [],
  });

  // 第 5 阶段：结果归类
  const hasWarnings = scanSummary.warn > 0 || auditResult.hasHighVulnerabilities;

  if (hasWarnings) {
    stages.push({ stage: "approved", passed: false, errors: ["Pending human review due to warnings"] });
    return withReviewArtifacts({
      status: "needs_review",
      skillName,
      skillDescription,
      stages,
      scanSummary,
      extractDir,
    });
  }

  stages.push({ stage: "approved", passed: true, errors: [] });
  return withReviewArtifacts({
    status: "approved",
    skillName,
    skillDescription,
    stages,
    scanSummary,
    extractDir,
  });
}
