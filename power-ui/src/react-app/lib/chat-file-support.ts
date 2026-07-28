export const CHAT_WORKSPACE_FILE_FORMATS = {
  pdf: "document",
  docx: "document",
  docm: "document",
  odt: "document",
  rtf: "text",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  ods: "spreadsheet",
  csv: "text",
  tsv: "text",
  pptx: "presentation",
  ppsx: "presentation",
  odp: "presentation",
  txt: "text",
  log: "text",
  md: "text",
  markdown: "text",
  json: "text",
  jsonl: "text",
  html: "text",
  htm: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  ini: "text",
  cfg: "text",
  conf: "text",
  sql: "text",
  css: "text",
  scss: "text",
  js: "text",
  jsx: "text",
  ts: "text",
  tsx: "text",
  py: "text",
  java: "text",
  c: "text",
  cc: "text",
  cpp: "text",
  h: "text",
  hpp: "text",
  go: "text",
  rs: "text",
  sh: "text",
  bash: "text",
  zsh: "text",
  ps1: "text",
  aac: "audio",
  caf: "audio",
  flac: "audio",
  mp3: "audio",
  m4a: "audio",
  oga: "audio",
  wav: "audio",
  ogg: "audio",
  opus: "audio",
  mp4: "video",
  m4v: "video",
  mov: "video",
  mpeg: "video",
  mpg: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
} as const;

export type ChatWorkspaceFileKind =
  (typeof CHAT_WORKSPACE_FILE_FORMATS)[keyof typeof CHAT_WORKSPACE_FILE_FORMATS];

export const CHAT_WORKSPACE_FILE_ACCEPT = Object.keys(CHAT_WORKSPACE_FILE_FORMATS)
  .map((extension) => `.${extension}`)
  .join(",");

export function chatFileExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index + 1) : "";
}

export function resolveChatWorkspaceFileKind(
  file: Pick<File, "name">,
): ChatWorkspaceFileKind | null {
  const extension = chatFileExtension(file.name);
  return CHAT_WORKSPACE_FILE_FORMATS[extension as keyof typeof CHAT_WORKSPACE_FILE_FORMATS] ?? null;
}

export function isSupportedWorkspaceChatFile(file: Pick<File, "name">): boolean {
  return resolveChatWorkspaceFileKind(file) !== null;
}

export const MAX_CHAT_DOCUMENT_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_CHAT_MEDIA_FILE_BYTES = 16 * 1024 * 1024;

export function maxWorkspaceChatFileBytes(file: Pick<File, "name">): number {
  const kind = resolveChatWorkspaceFileKind(file);
  return kind === "audio" || kind === "video"
    ? MAX_CHAT_MEDIA_FILE_BYTES
    : MAX_CHAT_DOCUMENT_FILE_BYTES;
}

const LEGACY_OFFICE_REPLACEMENT: Record<string, string> = {
  doc: "DOCX",
  xls: "XLSX",
  ppt: "PPTX",
};

export function unsupportedWorkspaceChatFileReason(file: Pick<File, "name">): string | null {
  const replacement = LEGACY_OFFICE_REPLACEMENT[chatFileExtension(file.name)];
  return replacement
    ? `旧版 Office 文件 ${file.name} 暂不支持，请另存为 ${replacement} 后上传。`
    : null;
}
