import path from "node:path";
import { RULE_CAPABILITY_LABELS } from "./policy.js";
import type { NetworkObservation, ScanSummary, SkillStatus, ValidationResult } from "./types.js";

type ReviewArtifactInput = {
  status: SkillStatus;
  skillName?: string;
  skillDescription?: string;
  scanSummary?: ScanSummary;
  rejectionReason?: string;
  validationStages: ValidationResult[];
  baseDir?: string;
};

export type ReviewArtifacts = {
  reviewSummaryText: string;
  reviewReportMarkdown: string;
  networkObservations: NetworkObservation[];
};

function toDisplayPath(filePath: string, baseDir?: string): string {
  if (!baseDir) return filePath;
  const relativePath = path.relative(baseDir, filePath);
  return relativePath || path.basename(filePath);
}

function listCapabilities(scanSummary?: ScanSummary): string[] {
  if (!scanSummary) return [];
  const labels = new Set<string>();

  for (const finding of scanSummary.findings) {
    const label = RULE_CAPABILITY_LABELS[finding.ruleId];
    if (label) labels.add(label);
  }

  if (scanSummary.networkObservations.length > 0) {
    labels.add("网络访问");
  }

  return [...labels];
}

function summarizeNetworkObservation(observation: NetworkObservation, baseDir?: string): string {
  const location = `${toDisplayPath(observation.file, baseDir)}:${observation.line}`;
  const method = observation.method ?? "UNKNOWN";
  const target = observation.target ?? "动态目标";
  const protocol = observation.protocol ?? observation.transport;
  const host = observation.host ? ` host=${observation.host}` : "";
  const port = observation.port ? ` port=${observation.port}` : "";
  return `${method} ${target} (${protocol}${host}${port}, ${location})`;
}

function buildReviewSummaryText(input: ReviewArtifactInput): string {
  const scanSummary = input.scanSummary;
  const networkCount = scanSummary?.networkObservations.length ?? 0;
  const capabilitySummary = listCapabilities(scanSummary);
  const findingCount = scanSummary?.findings.length ?? 0;

  const parts = [
    `结论：${input.status}`,
    input.skillName ? `技能：${input.skillName}` : undefined,
    scanSummary ? `扫描文件 ${scanSummary.scannedFiles} 个` : undefined,
    scanSummary ? `发现 critical ${scanSummary.critical} 项、warn ${scanSummary.warn} 项` : undefined,
    findingCount > 0 ? `共命中规则 ${findingCount} 项` : undefined,
    networkCount > 0 ? `识别到网络访问 ${networkCount} 条` : undefined,
    capabilitySummary.length > 0 ? `高风险能力：${capabilitySummary.join("、")}` : undefined,
    input.rejectionReason ? `原因：${input.rejectionReason}` : undefined,
  ].filter(Boolean);

  return parts.join("；");
}

function buildMarkdown(input: ReviewArtifactInput): string {
  const scanSummary = input.scanSummary;
  const capabilities = listCapabilities(scanSummary);
  const lines: string[] = [
    "# 审核报告",
    "",
    "## 基本信息",
    "",
    `- 技能名称：${input.skillName ?? "未识别"}`,
    `- 技能描述：${input.skillDescription ?? "未识别"}`,
    `- 审核结论：${input.status}`,
  ];

  if (input.rejectionReason) {
    lines.push(`- 拒绝原因：${input.rejectionReason}`);
  }

  lines.push("", "## 阶段结果", "");
  for (const stage of input.validationStages) {
    lines.push(`- ${stage.stage}：${stage.passed ? "通过" : "未通过"}${stage.errors.length > 0 ? `；${stage.errors.join("；")}` : ""}`);
  }

  if (!scanSummary) {
    return lines.join("\n");
  }

  lines.push(
    "",
    "## 风险统计",
    "",
    `- 扫描文件数：${scanSummary.scannedFiles}`,
    `- critical：${scanSummary.critical}`,
    `- warn：${scanSummary.warn}`,
    `- info：${scanSummary.info}`,
    `- 网络访问观察：${scanSummary.networkObservations.length}`,
  );

  lines.push("", "## 高风险能力", "");
  if (capabilities.length === 0) {
    lines.push("- 未识别到需要人工关注的高风险能力");
  } else {
    for (const capability of capabilities) {
      lines.push(`- ${capability}`);
    }
  }

  lines.push("", "## 网络访问观察", "");
  if (scanSummary.networkObservations.length === 0) {
    lines.push("- 未识别到静态网络访问");
  } else {
    for (const observation of scanSummary.networkObservations) {
      lines.push(`- ${summarizeNetworkObservation(observation, input.baseDir)}`);
    }
  }

  lines.push("", "## 关键发现", "");
  if (scanSummary.findings.length === 0) {
    lines.push("- 未发现规则命中");
  } else {
    for (const finding of scanSummary.findings) {
      const location = `${toDisplayPath(finding.file, input.baseDir)}:${finding.line}`;
      lines.push(`- [${finding.severity}] ${finding.ruleId} @ ${location}：${finding.message}`);
    }
  }

  lines.push("", "## 人工复核建议", "");
  if (input.status === "rejected") {
    lines.push("- 当前结果建议直接拒绝，除非能明确证明命中规则属于误报。");
  } else if (input.status === "needs_review") {
    lines.push("- 建议重点复核网络访问目标、敏感对象访问意图，以及是否存在越权操作风险。");
  } else {
    lines.push("- 当前未发现需要人工重点关注的问题，但仍建议结合业务语义抽样复核。");
  }

  return lines.join("\n");
}

export function buildReviewArtifacts(input: ReviewArtifactInput): ReviewArtifacts {
  return {
    reviewSummaryText: buildReviewSummaryText(input),
    reviewReportMarkdown: buildMarkdown(input),
    networkObservations: input.scanSummary?.networkObservations ?? [],
  };
}
