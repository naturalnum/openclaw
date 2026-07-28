import { describe, expect, it } from "vitest";
import {
  CHAT_WORKSPACE_FILE_ACCEPT,
  isSupportedWorkspaceChatFile,
  maxWorkspaceChatFileBytes,
  resolveChatWorkspaceFileKind,
  unsupportedWorkspaceChatFileReason,
} from "./chat-file-support";

describe("chat workspace file support", () => {
  it.each([
    ["report.PDF", "document"],
    ["report.docx", "document"],
    ["report.docm", "document"],
    ["report.odt", "document"],
    ["data.xlsx", "spreadsheet"],
    ["data.xlsm", "spreadsheet"],
    ["data.ods", "spreadsheet"],
    ["slides.pptx", "presentation"],
    ["slides.ppsx", "presentation"],
    ["slides.odp", "presentation"],
    ["notes.md", "text"],
    ["source.ts", "text"],
    ["audio.flac", "audio"],
    ["audio.opus", "audio"],
    ["video.mp4", "video"],
    ["video.webm", "video"],
  ] as const)("recognizes %s as %s", (name, kind) => {
    expect(resolveChatWorkspaceFileKind({ name })).toBe(kind);
    expect(isSupportedWorkspaceChatFile({ name })).toBe(true);
  });

  it("rejects unsupported and legacy binary Office formats", () => {
    expect(isSupportedWorkspaceChatFile({ name: "legacy.doc" })).toBe(false);
    expect(isSupportedWorkspaceChatFile({ name: "legacy.xls" })).toBe(false);
    expect(isSupportedWorkspaceChatFile({ name: "legacy.ppt" })).toBe(false);
    expect(isSupportedWorkspaceChatFile({ name: "archive.zip" })).toBe(false);
    expect(unsupportedWorkspaceChatFileReason({ name: "legacy.doc" })).toContain("DOCX");
    expect(unsupportedWorkspaceChatFileReason({ name: "legacy.xls" })).toContain("XLSX");
    expect(unsupportedWorkspaceChatFileReason({ name: "legacy.ppt" })).toContain("PPTX");
  });

  it("uses media and document size limits that match backend processing", () => {
    expect(maxWorkspaceChatFileBytes({ name: "recording.mp3" })).toBe(16 * 1024 * 1024);
    expect(maxWorkspaceChatFileBytes({ name: "movie.mp4" })).toBe(16 * 1024 * 1024);
    expect(maxWorkspaceChatFileBytes({ name: "report.pdf" })).toBe(100 * 1024 * 1024);
  });

  it("exposes every supported extension to the native file picker", () => {
    for (const extension of ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "mp3", "mp4"]) {
      expect(CHAT_WORKSPACE_FILE_ACCEPT.split(",")).toContain(`.${extension}`);
    }
  });
});
