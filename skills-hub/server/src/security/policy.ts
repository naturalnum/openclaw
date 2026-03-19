import type { ScanSeverity } from "./types.js";

// ---------------------------------------------------------------------------
// 审核策略配置
// ---------------------------------------------------------------------------

export type SensitivePattern = {
  id: string;
  label: string;
  pattern: RegExp;
  severity: ScanSeverity;
};

export type NetworkClientPattern = {
  id: string;
  kind: "http" | "websocket" | "unknown";
  pattern: RegExp;
  defaultMethod?: string;
};

export const SENSITIVE_PATH_PATTERNS: SensitivePattern[] = [
  { id: "dotenv-file", label: ".env 配置文件", pattern: /\.env(?:\.[A-Za-z0-9_-]+)?\b/i, severity: "warn" },
  { id: "ssh-config", label: ".ssh 目录或私钥文件", pattern: /\.ssh\b|id_rsa\b|id_ed25519\b/i, severity: "warn" },
  { id: "cloud-credentials", label: "云厂商凭证目录", pattern: /\.aws\b|\.kube\b|gcloud\b|credentials\b/i, severity: "warn" },
  { id: "system-secrets", label: "系统敏感账户文件", pattern: /\/etc\/passwd\b|\/etc\/shadow\b/i, severity: "warn" },
  { id: "docker-socket", label: "Docker 套接字", pattern: /\/var\/run\/docker\.sock\b/i, severity: "warn" },
  { id: "token-cache", label: "令牌或 Cookie 存储文件", pattern: /cookie|session|token|secret/i, severity: "warn" },
];

export const SENSITIVE_ENV_PATTERNS: SensitivePattern[] = [
  { id: "api-key", label: "API Key", pattern: /\b[A-Z0-9_]*API[_-]?KEY[A-Z0-9_]*\b/i, severity: "warn" },
  { id: "access-token", label: "访问令牌", pattern: /\b[A-Z0-9_]*(TOKEN|ACCESS_TOKEN|REFRESH_TOKEN)[A-Z0-9_]*\b/i, severity: "warn" },
  { id: "client-secret", label: "客户端密钥", pattern: /\b[A-Z0-9_]*(SECRET|CLIENT_SECRET)[A-Z0-9_]*\b/i, severity: "warn" },
  { id: "password", label: "口令", pattern: /\b[A-Z0-9_]*(PASSWORD|PASSWD|PWD)[A-Z0-9_]*\b/i, severity: "warn" },
  { id: "cookie-session", label: "会话或 Cookie", pattern: /\b[A-Z0-9_]*(COOKIE|SESSION)[A-Z0-9_]*\b/i, severity: "warn" },
];

export const NETWORK_CLIENT_PATTERNS: NetworkClientPattern[] = [
  { id: "fetch", kind: "http", pattern: /\bfetch\s*\(/, defaultMethod: "GET" },
  { id: "axios", kind: "http", pattern: /\baxios\.(get|post|put|patch|delete|request)\s*\(/ },
  { id: "got", kind: "http", pattern: /\bgot(?:\.(get|post|put|patch|delete))?\s*\(/ },
  { id: "http-request", kind: "http", pattern: /\bhttps?\.request\s*\(/ },
  { id: "websocket", kind: "websocket", pattern: /\bnew\s+WebSocket\s*\(/ },
  { id: "requests", kind: "http", pattern: /\brequests\.(get|post|put|patch|delete)\s*\(/ },
  { id: "urllib", kind: "http", pattern: /\burllib\.request\.(urlopen|Request)\s*\(/ },
  { id: "curl", kind: "http", pattern: /\bcurl\b/ },
  { id: "wget", kind: "http", pattern: /\bwget\b/, defaultMethod: "GET" },
];

export const RULE_CAPABILITY_LABELS: Record<string, string> = {
  "dangerous-exec": "命令执行",
  "dynamic-code-execution": "动态代码执行",
  "crypto-mining": "挖矿行为",
  "env-harvesting": "环境变量读取并外传",
  "potential-exfiltration": "文件读取并网络发送",
  "suspicious-network": "异常网络端口访问",
  "js-sensitive-path-access": "敏感路径访问",
  "js-sensitive-env-access": "敏感环境变量访问",
  "js-download-and-execute": "下载后二次执行",
  "py-exec": "命令执行",
  "py-eval": "动态代码执行",
  "py-crypto-mining": "挖矿行为",
  "py-env-harvest": "环境变量读取并外传",
  "py-exfiltration": "文件读取并网络发送",
  "py-sensitive-path-access": "敏感路径访问",
  "py-sensitive-env-access": "敏感环境变量访问",
  "py-download-and-execute": "下载后二次执行",
  "sh-download-exec": "远程下载直接执行",
  "sh-eval": "动态代码执行",
  "sh-crypto-mining": "挖矿行为",
  "sh-env-exfil": "环境变量读取并外传",
  "sh-sensitive-path-access": "敏感路径访问",
  "sh-sensitive-env-access": "敏感环境变量访问",
  "sh-download-and-execute": "下载后二次执行",
};
