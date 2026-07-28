// @vitest-environment jsdom

import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { GatewayWorkbenchAdapter } from "./gateway-workbench-adapter";

async function createWordFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>测试论文内容</w:t></w:r></w:p></w:body></w:document>',
  );
  return new File([await zip.generateAsync({ type: "uint8array" })], "paper.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

describe("GatewayWorkbenchAdapter.uploadChatFiles", () => {
  it("encodes and uploads a real Word File through the WebSocket RPC path", async () => {
    const adapter = new GatewayWorkbenchAdapter({
      getSettings: () => ({ gatewayUrl: "ws://127.0.0.1:18789", token: "test-token" }),
    });
    const request = vi.fn().mockResolvedValue({
      entries: [{ name: "paper.docx", path: ".chat-uploads/paper.docx", kind: "file" }],
    });
    Object.defineProperty(adapter, "gateway", { value: { request } });
    const file = new File(["synthetic word package"], "paper.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const result = await adapter.uploadProjectFiles("admin-default", ".chat-uploads", [
      { name: file.name, file },
    ]);

    expect(request).toHaveBeenCalledWith("power.fs.uploadFiles", {
      agentId: "admin-default",
      path: ".chat-uploads",
      files: [
        {
          name: "paper.docx",
          contentBase64: btoa("synthetic word package"),
        },
      ],
    });
    expect(result).toEqual([
      { name: "paper.docx", path: ".chat-uploads/paper.docx", kind: "file" },
    ]);
  });

  it("uploads quick-chat Word files inside the session workspace", async () => {
    const adapter = new GatewayWorkbenchAdapter({
      getSettings: () => ({ gatewayUrl: "ws://127.0.0.1:18789", token: "test-token" }),
      getUserScope: () => "u-admin",
    });
    const request = vi.fn().mockResolvedValue({});
    Object.defineProperty(adapter, "gateway", { value: { request } });
    Object.defineProperty(adapter, "configSnapshot", {
      configurable: true,
      writable: true,
      value: {
        agents: {
          defaults: { workspace: "/srv/agent/data/workspace" },
          list: [
            {
              id: "admin-default",
              workspace: "/srv/agent/data/users/admin/default",
            },
          ],
        },
      },
    });
    const createProjectFolder = vi
      .spyOn(adapter, "createProjectFolder")
      .mockResolvedValue({ name: "folder", path: "folder", kind: "directory" });
    const uploadProjectFiles = vi
      .spyOn(adapter, "uploadProjectFiles")
      .mockImplementation(async (_agentId, path, entries) =>
        entries.map((entry) => ({
          name: entry.name,
          path: `/srv/agent/data/users/admin/default/${path}/${entry.name}`,
          kind: "file" as const,
        })),
      );
    const wordFile = await createWordFile();

    const result = await adapter.uploadChatFiles(
      "admin-default",
      "agent:admin-default:quick:session-1",
      [{ name: "paper.docx", file: wordFile }],
      { quickChat: true },
    );

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:admin-default:quick:session-1",
      workspaceDir: "/srv/agent/data/users/admin/default/temp/agent-admin-default-quick-session-1",
    });
    expect(createProjectFolder).toHaveBeenNthCalledWith(1, "admin-default", null, "temp");
    expect(createProjectFolder).toHaveBeenNthCalledWith(
      2,
      "admin-default",
      "temp",
      "agent-admin-default-quick-session-1",
    );
    expect(createProjectFolder).toHaveBeenNthCalledWith(
      3,
      "admin-default",
      "temp/agent-admin-default-quick-session-1",
      ".chat-uploads",
    );
    expect(uploadProjectFiles).toHaveBeenCalledWith(
      "admin-default",
      "temp/agent-admin-default-quick-session-1/.chat-uploads",
      expect.arrayContaining([
        expect.objectContaining({ name: "paper.docx" }),
        expect.objectContaining({ name: "paper.docx.txt" }),
      ]),
    );
    expect(result).toEqual([
      {
        name: "paper.docx",
        path: ".chat-uploads/paper.docx",
        readablePath: ".chat-uploads/paper.docx.txt",
        kind: "file",
      },
    ]);
  });

  it("uses the gateway media pipeline and returns its readable transcript path", async () => {
    const adapter = new GatewayWorkbenchAdapter({
      getSettings: () => ({ gatewayUrl: "ws://127.0.0.1:18789", token: "test-token" }),
    });
    const request = vi.fn(async (method: string) =>
      method === "power.media.prepareWorkspaceFile"
        ? {
            prepared: true,
            readablePath: ".chat-uploads/session/meeting.mp3.txt",
          }
        : {},
    );
    Object.defineProperty(adapter, "gateway", { value: { request } });
    Object.defineProperty(adapter, "configSnapshot", {
      configurable: true,
      writable: true,
      value: {
        agents: {
          list: [
            {
              id: "admin-default",
              workspace: "/srv/agent/data/users/admin/default",
            },
          ],
        },
      },
    });
    vi.spyOn(adapter, "createProjectFolder").mockResolvedValue({
      name: "folder",
      path: "folder",
      kind: "directory",
    });
    vi.spyOn(adapter, "uploadProjectFiles").mockResolvedValue([
      {
        name: "meeting.mp3",
        path: "/srv/agent/data/users/admin/default/.chat-uploads/session/meeting.mp3",
        kind: "file",
      },
    ]);

    const result = await adapter.uploadChatFiles(
      "admin-default",
      "session",
      [{ name: "meeting.mp3", file: new File(["audio"], "meeting.mp3") }],
      { quickChat: false },
    );

    expect(request).toHaveBeenCalledWith("power.media.prepareWorkspaceFile", {
      agentId: "admin-default",
      path: "/srv/agent/data/users/admin/default/.chat-uploads/session/meeting.mp3",
    });
    expect(result).toEqual([
      {
        name: "meeting.mp3",
        path: ".chat-uploads/session/meeting.mp3",
        readablePath: ".chat-uploads/session/meeting.mp3.txt",
        kind: "file",
      },
    ]);
  });
});
