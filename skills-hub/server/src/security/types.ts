// ---------------------------------------------------------------------------
// SkillCenter 安全校验相关类型
// ---------------------------------------------------------------------------

export type SkillStatus = "pending" | "approved" | "rejected" | "needs_review";

export type ScanSeverity = "info" | "warn" | "critical";

export type ScanFinding = {
  ruleId: string;
  severity: ScanSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type NetworkObservation = {
  file: string;
  line: number;
  transport: "http" | "websocket" | "unknown";
  method?: string;
  target?: string;
  host?: string;
  protocol?: string;
  port?: number;
  isDynamic: boolean;
  evidence: string;
};

export type ScanSummary = {
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  findings: ScanFinding[];
  networkObservations: NetworkObservation[];
};

export type ValidationResult = {
  stage: "structure" | "frontmatter" | "code_scan" | "dependency" | "approved";
  passed: boolean;
  errors: string[];
  scanSummary?: ScanSummary;
};

export type ValidationResponse = {
  name?: string;
  description?: string;
  status: SkillStatus;
  scanResults?: ScanSummary;
  networkObservations: NetworkObservation[];
  rejectionReason?: string;
  reviewSummaryText: string;
  reviewReportMarkdown: string;
  validationStages: ValidationResult[];
};
