import { extractText } from "../../compat/chat";

export type ChatToolStep = {
  complete: boolean;
  detail: string;
  key: string;
  label: string;
};

function stringifyToolValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return JSON.stringify(value) ?? "";
}

function truncateToolPreview(text: string, max = 180): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function pathBasename(value: string): string {
  const normalized = value.replaceAll("\\", "/").trim();
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? normalized) : normalized;
}

/** 步骤条不展示完整路径，避免进度文案随绝对路径变化而跳动。 */
function humanizePathTokens(text: string): string {
  return text.replace(/(?:~\/|\/)[^\s'"`;|&]+/g, (segment) => {
    const base = pathBasename(segment);
    return base.length > 0 && base.length < segment.length ? base : segment;
  });
}

function extractExecCommand(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "";
  }
  const record = args as Record<string, unknown>;
  if (typeof record.command === "string" && record.command.trim()) {
    return record.command.trim();
  }
  if (typeof record.cmd === "string" && record.cmd.trim()) {
    return record.cmd.trim();
  }
  if (Array.isArray(record.argv)) {
    return record.argv
      .map((part) => (typeof part === "string" ? part : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

function shortenExecCommandLabel(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "运行命令";
  }
  const firstClause = normalized.split(/[;&|]/)[0]?.trim() ?? normalized;

  if (/\b(pip3?|uv)\s+install\b/i.test(firstClause)) {
    return "安装依赖";
  }
  if (/^\s*cd\s+/i.test(firstClause)) {
    return "切换工作目录";
  }
  if (/\b(python3?|python)\s+\S+\.py\b/i.test(firstClause)) {
    const match = firstClause.match(/\b(python3?|python)\s+(\S+\.py)\b/i);
    const script = match?.[2] ? pathBasename(match[2]) : "Python 脚本";
    return `运行 ${script}`;
  }
  if (/\b(node|bun)\s+\S+\.(?:mjs|cjs|js|ts)\b/i.test(firstClause)) {
    const match = firstClause.match(/\b(node|bun)\s+(\S+)/i);
    const script = match?.[2] ? pathBasename(match[2]) : "脚本";
    return `运行 ${script}`;
  }
  if (/\bfc-list\b/i.test(firstClause) || /\bfont\b/i.test(firstClause)) {
    return "检查字体";
  }
  if (/\bwhich\s+\S+/i.test(firstClause)) {
    const match = firstClause.match(/\bwhich\s+(\S+)/i);
    return `查找 ${match?.[1] ?? "命令"}`;
  }
  if (/\b(pdf|pandoc|pdflatex|wkhtmltopdf|reportlab|fpdf)\b/i.test(firstClause)) {
    return "生成 PDF";
  }
  if (/\b(brew|apt|dnf|yum)\b/i.test(firstClause)) {
    return "检查本地环境";
  }
  if (/\bls\b/i.test(firstClause)) {
    return "列出目录";
  }
  if (/\bcat\s+\S+/i.test(firstClause)) {
    const match = firstClause.match(/\bcat\s+(\S+)/i);
    return `查看 ${match?.[1] ?? "文件"}`;
  }
  if (/\bmkdir\b/i.test(firstClause)) {
    return "创建目录";
  }
  if (/\bchmod\b/i.test(firstClause)) {
    return "修改权限";
  }

  return truncateToolPreview(humanizePathTokens(firstClause), 48);
}

function friendlyToolLabel(name: string, args: unknown): string {
  const normalizedName = name.toLowerCase();
  const argText = stringifyToolValue(args).toLowerCase();
  if (normalizedName.includes("exec")) {
    const command = extractExecCommand(args);
    if (command) {
      return shortenExecCommandLabel(command);
    }
    if (/\b(pdf|pandoc|pdflatex|wkhtmltopdf|reportlab|fpdf)\b/.test(argText)) {
      return "生成 PDF 文件";
    }
    if (/\b(brew|which|fc-list|python3? -c|node -e)\b/.test(argText)) {
      return "检查本地环境";
    }
    return "运行命令";
  }
  if (normalizedName.includes("read")) {
    return "读取文件";
  }
  if (normalizedName.includes("write") || normalizedName.includes("edit")) {
    return "写入文件";
  }
  if (normalizedName.includes("search") || normalizedName.includes("rg")) {
    return "查找资料";
  }
  return name;
}

const GENERIC_TOOL_STEP_DETAILS = new Set([
  "正在处理，请稍候。",
  "正在执行必要的本地步骤。",
  "本地步骤已完成。",
  "本地步骤已完成，正在整理结果。",
  "已完成。",
  "这一步已完成。",
]);

export function isGenericToolStepDetail(detail: string): boolean {
  return GENERIC_TOOL_STEP_DETAILS.has(detail.trim());
}

function friendlyToolDetail(_params: {
  args: unknown;
  complete: boolean;
  name: string;
  resultText: string;
}): string {
  // 步骤条只展示稳定标题，不展示命令/工具输出，避免完成后副文案突变。
  return "";
}

export function getToolStepFromMessage(
  message: Record<string, unknown>,
): Omit<ChatToolStep, "key"> | null {
  const content = message.content;
  if (!Array.isArray(content)) {
    const fallback = extractText(message);
    return fallback
      ? {
          complete: true,
          detail: "",
          label: "工具结果",
        }
      : null;
  }

  const entries = content.filter(
    (item): item is Record<string, unknown> => item != null && typeof item === "object",
  );
  const call = entries.find((item) => item.type === "toolcall");
  const result = entries.find((item) => item.type === "toolresult" || item.type === "tool_result");
  const rawName =
    (typeof call?.name === "string" && call.name.trim()) ||
    (typeof result?.name === "string" && result.name.trim()) ||
    "工具";
  const resultTextRaw =
    (typeof result?.text === "string" && result.text) ||
    (typeof result?.content === "string" && result.content) ||
    "";
  const resultText = resultTextRaw.trim() ? truncateToolPreview(resultTextRaw) : "";
  const args = call?.arguments ?? call?.args;
  const label = friendlyToolLabel(rawName, args);
  const hasResult = Boolean(result) || resultText.length > 0;

  return {
    complete: hasResult,
    detail: friendlyToolDetail({
      args,
      complete: hasResult,
      name: rawName,
      resultText,
    }),
    label,
  };
}

/** 已有下一步时，将更早的进行中步骤视为已完成（避免全部显示 loading）。 */
export function applyToolStepProgressInference(steps: ChatToolStep[]): ChatToolStep[] {
  if (steps.length <= 1) {
    return steps;
  }
  return steps.map((step, index) => {
    if (step.complete || index >= steps.length - 1) {
      return step;
    }
    return {
      ...step,
      complete: true,
      detail: "",
    };
  });
}

/** 本轮对话结束时，将全部步骤标记为已完成并保留展示。 */
export function finalizeChatToolStepsForRunEnd(steps: ChatToolStep[]): ChatToolStep[] {
  if (steps.length === 0) {
    return steps;
  }
  return steps.map((step) => ({
    ...step,
    complete: true,
    detail: step.detail,
  }));
}

/** 合并连续相同标题的步骤，避免「执行本地步骤」刷屏。 */
export function collapseDuplicateToolSteps(steps: ChatToolStep[]): ChatToolStep[] {
  if (steps.length <= 1) {
    return steps;
  }
  const merged: ChatToolStep[] = [];
  for (const step of steps) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === step.label) {
      const countMatch = prev.label.match(/（×(\d+)）$/);
      const base = prev.label.replace(/（×\d+）$/, "");
      const count = countMatch ? Number.parseInt(countMatch[1] ?? "1", 10) + 1 : 2;
      merged[merged.length - 1] = {
        ...step,
        complete: prev.complete && step.complete,
        detail: step.detail || prev.detail,
        key: step.key,
        label: `${base}（×${count}）`,
      };
      continue;
    }
    merged.push(step);
  }
  return merged;
}

function resolveToolStepKey(
  message: Record<string, unknown>,
  index: number,
  keyPrefix: string,
): string {
  const toolCallId =
    (typeof message.toolCallId === "string" && message.toolCallId.trim()) ||
    (typeof message.tool_call_id === "string" && message.tool_call_id.trim()) ||
    "";
  if (toolCallId) {
    return `${keyPrefix}-${toolCallId}`;
  }
  const runId = typeof message.runId === "string" ? message.runId.trim() : "";
  if (runId) {
    return `${keyPrefix}-${runId}-${index}`;
  }
  return `${keyPrefix}-${index}`;
}

/** 刷新步骤时保留已展示标题，仅更新完成状态，避免进度区文案来回变。 */
export function mergeStableChatToolSteps(
  prev: ChatToolStep[],
  next: ChatToolStep[],
): ChatToolStep[] {
  if (prev.length === 0) {
    return next;
  }
  const prevByKey = new Map(prev.map((step) => [step.key, step]));
  return next.map((step) => {
    const earlier = prevByKey.get(step.key);
    if (!earlier) {
      return step;
    }
    return {
      ...step,
      label: earlier.label,
      detail: "",
    };
  });
}

export function buildChatToolSteps(messages: unknown[], keyPrefix = "tool"): ChatToolStep[] {
  const steps: ChatToolStep[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message == null || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    const step = getToolStepFromMessage(record);
    if (!step) {
      continue;
    }
    const detail = isGenericToolStepDetail(step.detail) ? "" : step.detail;
    steps.push({ ...step, detail, key: resolveToolStepKey(record, i, keyPrefix) });
  }
  return collapseDuplicateToolSteps(applyToolStepProgressInference(steps));
}
