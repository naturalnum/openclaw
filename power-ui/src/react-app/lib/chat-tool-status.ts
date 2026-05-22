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
  if (/\b(python3?|python)\s+\S+\.py\b/i.test(firstClause)) {
    const match = firstClause.match(/\b(python3?|python)\s+(\S+\.py)\b/i);
    return `运行 ${match?.[2] ?? "Python 脚本"}`;
  }
  if (/\b(node|bun)\s+\S+\.(?:mjs|cjs|js|ts)\b/i.test(firstClause)) {
    const match = firstClause.match(/\b(node|bun)\s+(\S+)/i);
    return `运行 ${match?.[2] ?? "脚本"}`;
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

  return truncateToolPreview(firstClause, 48);
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

function friendlyToolDetail(params: {
  args: unknown;
  complete: boolean;
  name: string;
  resultText: string;
}): string {
  if (params.complete && params.resultText) {
    return params.resultText;
  }
  const argText = stringifyToolValue(params.args).toLowerCase();
  if (params.name.toLowerCase().includes("exec")) {
    if (params.complete) {
      return "";
    }
    if (/\b(pdf|pandoc|pdflatex|wkhtmltopdf|reportlab|fpdf)\b/.test(argText)) {
      return "正在准备 PDF 生成所需的依赖和文件。";
    }
    return "";
  }
  if (!params.complete) {
    return "";
  }
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
          detail: truncateToolPreview(fallback),
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

export function buildChatToolSteps(messages: unknown[], keyPrefix = "tool"): ChatToolStep[] {
  const steps: ChatToolStep[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message == null || typeof message !== "object") {
      continue;
    }
    const step = getToolStepFromMessage(message as Record<string, unknown>);
    if (!step) {
      continue;
    }
    const detail = isGenericToolStepDetail(step.detail) ? "" : step.detail;
    steps.push({ ...step, detail, key: `${keyPrefix}-${i}` });
  }
  return collapseDuplicateToolSteps(applyToolStepProgressInference(steps));
}
