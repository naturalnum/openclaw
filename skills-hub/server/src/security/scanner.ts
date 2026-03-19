/**
 * Skill 代码安全扫描器。
 * 支持 JS/TS、Python、Shell 脚本规则集。
 */

import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import {
  NETWORK_CLIENT_PATTERNS,
  SENSITIVE_ENV_PATTERNS,
  SENSITIVE_PATH_PATTERNS,
} from "./policy.js";
import type {
  NetworkObservation,
  ScanFinding,
  ScanSeverity,
  ScanSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// 可扫描的文件扩展名
// ---------------------------------------------------------------------------

const JS_TS_EXTENSIONS = new Set([
  ".js", ".ts", ".mjs", ".cjs", ".mts", ".cts", ".jsx", ".tsx",
]);
const PYTHON_EXTENSIONS = new Set([".py"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".ksh", ".fish"]);

const DEFAULT_MAX_SCAN_FILES = 500;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000]);

const SENSITIVE_PATH_REGEX = new RegExp(
  SENSITIVE_PATH_PATTERNS.map((entry) => `(?:${entry.pattern.source})`).join("|"),
  "i",
);
const SENSITIVE_ENV_REGEX = new RegExp(
  SENSITIVE_ENV_PATTERNS.map((entry) => `(?:${entry.pattern.source})`).join("|"),
  "i",
);

export function isScannable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return JS_TS_EXTENSIONS.has(ext) || PYTHON_EXTENSIONS.has(ext) || SHELL_EXTENSIONS.has(ext);
}

function isPython(filePath: string): boolean {
  return PYTHON_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isShell(filePath: string): boolean {
  return SHELL_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// 规则定义
// ---------------------------------------------------------------------------

type LineRule = {
  ruleId: string;
  severity: ScanSeverity;
  message: string;
  pattern: RegExp;
  requiresContext?: RegExp;
};

type SourceRule = {
  ruleId: string;
  severity: ScanSeverity;
  message: string;
  pattern: RegExp;
  requiresContext?: RegExp;
};

const JS_LINE_RULES: LineRule[] = [
  {
    ruleId: "dangerous-exec",
    severity: "critical",
    message: "Shell command execution detected (child_process)",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    requiresContext: /child_process/,
  },
  {
    ruleId: "dynamic-code-execution",
    severity: "critical",
    message: "Dynamic code execution detected",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    ruleId: "crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
  },
  {
    ruleId: "suspicious-network",
    severity: "warn",
    message: "WebSocket connection to non-standard port",
    pattern: /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/,
  },
];

const JS_SOURCE_RULES: SourceRule[] = [
  {
    ruleId: "potential-exfiltration",
    severity: "warn",
    message: "File read combined with network send — possible data exfiltration",
    pattern: /readFileSync|readFile|createReadStream/,
    requiresContext: /\bfetch\b|\baxios\b|\bpost\b|http\.request|https\.request|got\./i,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Hex-encoded string sequence detected (possible obfuscation)",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}/,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Large base64 payload with decode call detected (possible obfuscation)",
    pattern: /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/,
  },
  {
    ruleId: "env-harvesting",
    severity: "critical",
    message: "Environment variable access combined with network send — possible credential harvesting",
    pattern: /process\.env/,
    requiresContext: /\bfetch\b|\baxios\b|\bpost\b|http\.request|https\.request|got\./i,
  },
  {
    ruleId: "js-sensitive-path-access",
    severity: "warn",
    message: "Sensitive file path access detected",
    pattern: /readFileSync|readFile|createReadStream|readdirSync|readdir/,
    requiresContext: SENSITIVE_PATH_REGEX,
  },
  {
    ruleId: "js-sensitive-env-access",
    severity: "warn",
    message: "Sensitive environment variable access detected",
    pattern: /process\.env/,
    requiresContext: SENSITIVE_ENV_REGEX,
  },
  {
    ruleId: "js-download-and-execute",
    severity: "critical",
    message: "Downloaded content written to disk and executed",
    pattern: /writeFileSync|writeFile|createWriteStream/,
    requiresContext:
      /(?:\bfetch\b|\baxios\b|\bgot\b|https?\.request)[\s\S]{0,600}(?:\bexec\b|\bexecSync\b|\bspawn\b|\bspawnSync\b|\bexecFile\b|\bexecFileSync\b)|(?:\bexec\b|\bexecSync\b|\bspawn\b|\bspawnSync\b|\bexecFile\b|\bexecFileSync\b)[\s\S]{0,600}(?:\bfetch\b|\baxios\b|\bgot\b|https?\.request)/i,
  },
];

const PY_LINE_RULES: LineRule[] = [
  {
    ruleId: "py-exec",
    severity: "critical",
    message: "Shell command execution detected (os/subprocess)",
    pattern: /\bos\.system\s*\(|\bsubprocess\.(run|call|Popen|check_output|check_call)\s*\(/,
  },
  {
    ruleId: "py-eval",
    severity: "critical",
    message: "Dynamic code execution detected (eval/exec)",
    pattern: /\beval\s*\(|\bexec\s*\(/,
  },
  {
    ruleId: "py-crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
  },
];

const PY_SOURCE_RULES: SourceRule[] = [
  {
    ruleId: "py-env-harvest",
    severity: "critical",
    message: "Environment variable access combined with network send — possible credential harvesting",
    pattern: /os\.environ|os\.getenv/,
    requiresContext: /requests\.(post|get|put|patch)|urllib\.request/,
  },
  {
    ruleId: "py-exfiltration",
    severity: "warn",
    message: "File read combined with network send — possible data exfiltration",
    pattern: /open\s*\([^)]*['"]\s*,\s*['"]r/,
    requiresContext: /requests\.(post|get|put|patch)|urllib\.request/,
  },
  {
    ruleId: "py-obfuscated-code",
    severity: "warn",
    message: "Large base64 payload with decode call detected (possible obfuscation)",
    pattern: /base64\.b64decode\s*\(\s*['"b][A-Za-z0-9+/=]{100,}/,
  },
  {
    ruleId: "py-sensitive-path-access",
    severity: "warn",
    message: "Sensitive file path access detected",
    pattern: /open\s*\(|Path\s*\(|read_text\s*\(|read_bytes\s*\(/,
    requiresContext: SENSITIVE_PATH_REGEX,
  },
  {
    ruleId: "py-sensitive-env-access",
    severity: "warn",
    message: "Sensitive environment variable access detected",
    pattern: /os\.environ|os\.getenv/,
    requiresContext: SENSITIVE_ENV_REGEX,
  },
  {
    ruleId: "py-download-and-execute",
    severity: "critical",
    message: "Downloaded content written to disk and executed",
    pattern: /open\s*\([^)]*['"]\s*,\s*['"]w|write_text\s*\(|write_bytes\s*\(/,
    requiresContext:
      /(?:requests\.(?:get|post|put|patch)|urllib\.request)[\s\S]{0,600}(?:os\.system|subprocess\.)|(?:os\.system|subprocess\.)[\s\S]{0,600}(?:requests\.(?:get|post|put|patch)|urllib\.request)/,
  },
];

const SH_LINE_RULES: LineRule[] = [
  {
    ruleId: "sh-download-exec",
    severity: "critical",
    message: "Remote code download and execution detected (curl/wget piped to shell)",
    pattern: /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba)?sh\b/,
  },
  {
    ruleId: "sh-eval",
    severity: "critical",
    message: "Dynamic code execution via eval detected",
    pattern: /\beval\s+(\$|\$\(|`)/,
  },
  {
    ruleId: "sh-crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
  },
];

const SH_SOURCE_RULES: SourceRule[] = [
  {
    ruleId: "sh-env-exfil",
    severity: "critical",
    message: "Environment variable access combined with remote POST — possible credential harvesting",
    pattern: /\$\{?[A-Z_]{4,}\}?/,
    requiresContext: /\bcurl\b.*(-X\s*POST|-d\s|--data\b)|wget\b.*--post-data/,
  },
  {
    ruleId: "sh-obfuscated",
    severity: "warn",
    message: "Base64-decoded content piped to shell execution (possible obfuscation)",
    pattern: /base64\s+(--decode|-d)\s*\|/,
    requiresContext: /(ba)?sh\b|eval\b/,
  },
  {
    ruleId: "sh-sensitive-path-access",
    severity: "warn",
    message: "Sensitive file path access detected",
    pattern: /\b(cat|grep|sed|awk|cp|tar|head|tail)\b/,
    requiresContext: SENSITIVE_PATH_REGEX,
  },
  {
    ruleId: "sh-sensitive-env-access",
    severity: "warn",
    message: "Sensitive environment variable access detected",
    pattern: /\$\{?[A-Z_]{4,}\}?/,
    requiresContext: SENSITIVE_ENV_REGEX,
  },
  {
    ruleId: "sh-download-and-execute",
    severity: "critical",
    message: "Downloaded file appears to be executed after being saved",
    pattern: /\b(curl|wget)\b/,
    requiresContext:
      /(?:\bcurl\b|\bwget\b)[\s\S]{0,400}(?:chmod\s+\+x|(?:ba)?sh\s+\S+|\.\/\S+)|(?:chmod\s+\+x|(?:ba)?sh\s+\S+|\.\/\S+)[\s\S]{0,400}(?:\bcurl\b|\bwget\b)/,
  },
];

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function truncateEvidence(evidence: string, maxLen = 120): string {
  return evidence.length <= maxLen ? evidence : `${evidence.slice(0, maxLen)}…`;
}

function extractLiteralTarget(line: string): string | undefined {
  const match = line.match(/((?:https?|wss?):\/\/[^\s"'`)<>\]]+)/i);
  return match?.[1];
}

function inferMethod(line: string, clientId: string, fallback?: string): string | undefined {
  const explicitMethod = line.match(/method\s*[:=]\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/i);
  if (explicitMethod) return explicitMethod[1].toUpperCase();

  const memberMethod = line.match(/\b(?:axios|got|requests)\.(get|post|put|patch|delete)\s*\(/i);
  if (memberMethod) return memberMethod[1].toUpperCase();

  if (clientId === "curl") {
    const curlMethod = line.match(/-X\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/i);
    if (curlMethod) return curlMethod[1].toUpperCase();
    if (/\s(-d|--data|--data-raw|--data-binary)\b/i.test(line)) return "POST";
  }

  if (clientId === "wget" && /--post-data\b/i.test(line)) return "POST";
  if (clientId === "websocket") return undefined;
  if (fallback) return fallback;
  if (/\bbody\s*:/.test(line)) return "POST";
  return undefined;
}

function normalizeTransport(target?: string, fallback: NetworkObservation["transport"] = "unknown") {
  if (!target) return fallback;
  if (target.startsWith("ws://") || target.startsWith("wss://")) return "websocket";
  if (target.startsWith("http://") || target.startsWith("https://")) return "http";
  return fallback;
}

function buildNetworkObservation(line: string, filePath: string, lineNumber: number): NetworkObservation | undefined {
  const client = NETWORK_CLIENT_PATTERNS.find((entry) => entry.pattern.test(line));
  if (!client) return undefined;

  const target = extractLiteralTarget(line);
  const transport = normalizeTransport(target, client.kind);
  const method = inferMethod(line, client.id, client.defaultMethod);

  let host: string | undefined;
  let protocol: string | undefined;
  let port: number | undefined;

  if (target) {
    try {
      const parsed = new URL(target);
      host = parsed.hostname;
      protocol = parsed.protocol.replace(/:$/, "");
      port = parsed.port ? parseInt(parsed.port, 10) : undefined;
    } catch {
      // URL parse failure — keep raw target
    }
  }

  return {
    file: filePath,
    line: lineNumber,
    transport,
    method,
    target,
    host,
    protocol,
    port,
    isDynamic: !target,
    evidence: truncateEvidence(line.trim()),
  };
}

export function extractNetworkObservations(source: string, filePath: string): NetworkObservation[] {
  const observations: NetworkObservation[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const observation = buildNetworkObservation(lines[i], filePath, i + 1);
    if (observation) observations.push(observation);
  }

  return observations;
}

export function scanSource(source: string, filePath: string): ScanFinding[] {
  const python = isPython(filePath);
  const shell = isShell(filePath);
  const lineRules = python ? PY_LINE_RULES : shell ? SH_LINE_RULES : JS_LINE_RULES;
  const sourceRules = python ? PY_SOURCE_RULES : shell ? SH_SOURCE_RULES : JS_SOURCE_RULES;

  const findings: ScanFinding[] = [];
  const lines = source.split("\n");
  const matchedLineRules = new Set<string>();

  for (const rule of lineRules) {
    if (matchedLineRules.has(rule.ruleId)) continue;
    if (rule.requiresContext && !rule.requiresContext.test(source)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = rule.pattern.exec(line);
      if (!match) continue;

      if (rule.ruleId === "suspicious-network") {
        const port = parseInt(match[1], 10);
        if (STANDARD_PORTS.has(port)) continue;
      }

      findings.push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: filePath,
        line: i + 1,
        message: rule.message,
        evidence: truncateEvidence(line.trim()),
      });
      matchedLineRules.add(rule.ruleId);
      break;
    }
  }

  const matchedSourceRules = new Set<string>();
  for (const rule of sourceRules) {
    const ruleKey = `${rule.ruleId}::${rule.message}`;
    if (matchedSourceRules.has(ruleKey)) continue;
    if (!rule.pattern.test(source)) continue;
    if (rule.requiresContext && !rule.requiresContext.test(source)) continue;

    let matchLine = 0;
    let matchEvidence = "";
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        matchLine = i + 1;
        matchEvidence = lines[i].trim();
        break;
      }
    }

    if (matchLine === 0) {
      matchLine = 1;
      matchEvidence = source.slice(0, 120);
    }

    findings.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      file: filePath,
      line: matchLine,
      message: rule.message,
      evidence: truncateEvidence(matchEvidence),
    });
    matchedSourceRules.add(ruleKey);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 目录扫描
// ---------------------------------------------------------------------------

async function walkDir(dirPath: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop();
    if (!current) break;

    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of dirents) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && isScannable(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export async function scanDirectory(
  dirPath: string,
  opts?: { maxFiles?: number; maxFileBytes?: number },
): Promise<ScanSummary> {
  const maxFiles = Math.max(1, opts?.maxFiles ?? DEFAULT_MAX_SCAN_FILES);
  const maxFileBytes = Math.max(1, opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);

  const files = await walkDir(dirPath, maxFiles);
  const allFindings: ScanFinding[] = [];
  const networkObservations: NetworkObservation[] = [];
  let scannedFiles = 0;
  let critical = 0;
  let warn = 0;
  let info = 0;

  for (const file of files) {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (stat.size > maxFileBytes) continue;

    let source: string;
    try {
      source = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }

    const findings = scanSource(source, file);
    const observations = extractNetworkObservations(source, file);
    scannedFiles += 1;
    networkObservations.push(...observations);

    for (const f of findings) {
      allFindings.push(f);
      if (f.severity === "critical") critical += 1;
      else if (f.severity === "warn") warn += 1;
      else info += 1;
    }
  }

  return { scannedFiles, critical, warn, info, findings: allFindings, networkObservations };
}
