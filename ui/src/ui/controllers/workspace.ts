import type { GatewayBrowserClient, GatewayUploadProgress } from "../gateway.ts";
import type { WorkspaceEntry, WorkspaceDownloadResult, WorkspaceListResult } from "../types.ts";

export type WorkspacePreviewState = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "text" | "image" | "pdf" | "none";
  textContent?: string;
  dataUrl?: string;
};

export type WorkspaceUploadState = {
  currentFileName: string;
  currentFileLoaded: number;
  currentFileTotal: number | null;
  currentFileIndex: number;
  totalFiles: number;
};

export type WorkspaceState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  workspaceLoading: boolean;
  workspaceBusy: boolean;
  workspaceError: string | null;
  workspaceList: WorkspaceListResult | null;
  workspaceSelectedPath: string | null;
  workspacePreview: WorkspacePreviewState | null;
  workspaceUpload: WorkspaceUploadState | null;
};

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function dataUrlFromBase64(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

function downloadBlob(filename: string, bytes: Uint8Array<ArrayBuffer>, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function requestWorkspaceFile(state: WorkspaceState, filePath: string) {
  if (!state.client || !state.connected) {
    throw new Error("workspace unavailable while disconnected");
  }
  return await state.client.request<WorkspaceDownloadResult>("workspace.download", {
    path: filePath,
  });
}

export async function loadWorkspaceList(state: WorkspaceState, nextPath?: string) {
  if (!state.client || !state.connected || state.workspaceLoading) {
    return;
  }
  state.workspaceLoading = true;
  state.workspaceError = null;
  try {
    const res = await state.client.request<WorkspaceListResult>(
      "workspace.list",
      typeof nextPath === "string" ? { path: nextPath } : {},
    );
    state.workspaceList = res;
    if (
      state.workspaceSelectedPath &&
      !res.entries.some((entry) => entry.path === state.workspaceSelectedPath)
    ) {
      state.workspaceSelectedPath = null;
      state.workspacePreview = null;
    }
  } catch (err) {
    state.workspaceError = getErrorMessage(err);
  } finally {
    state.workspaceLoading = false;
  }
}

export async function openWorkspaceEntry(state: WorkspaceState, entry: WorkspaceEntry) {
  if (entry.kind === "directory") {
    state.workspaceSelectedPath = null;
    state.workspacePreview = null;
    await loadWorkspaceList(state, entry.path);
    return;
  }

  state.workspaceBusy = true;
  state.workspaceError = null;
  state.workspaceSelectedPath = entry.path;
  try {
    const res = await requestWorkspaceFile(state, entry.path);
    const bytes = bytesFromBase64(res.file.contentBase64);
    const previewKind = res.file.previewKind;
    let preview: WorkspacePreviewState = {
      path: res.file.path,
      name: res.file.name,
      mimeType: res.file.mimeType,
      size: res.file.size,
      kind: previewKind,
    };
    if (previewKind === "text") {
      preview = {
        ...preview,
        textContent: new TextDecoder().decode(bytes),
      };
    } else if (previewKind === "image" || previewKind === "pdf") {
      preview = {
        ...preview,
        dataUrl: dataUrlFromBase64(res.file.contentBase64, res.file.mimeType),
      };
    }
    state.workspacePreview = preview;
  } catch (err) {
    state.workspaceError = getErrorMessage(err);
  } finally {
    state.workspaceBusy = false;
  }
}

export function selectWorkspaceEntry(state: WorkspaceState, entry: WorkspaceEntry) {
  state.workspaceSelectedPath = entry.path;
  if (entry.kind === "directory") {
    state.workspacePreview = null;
  }
}

function normalizeWorkspaceReference(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("/workspace/")) {
    return trimmed.slice("/workspace/".length);
  }
  if (trimmed === "/workspace") {
    return "";
  }
  return trimmed.replace(/^\.\//, "");
}

export async function openWorkspacePath(state: WorkspaceState, filePath: string) {
  const normalized = normalizeWorkspaceReference(filePath);
  if (!normalized) {
    await loadWorkspaceList(state, "");
    return;
  }
  const dirPath = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  await loadWorkspaceList(state, dirPath);
  const entry = state.workspaceList?.entries.find((item) => item.path === normalized);
  if (entry) {
    await openWorkspaceEntry(state, entry);
  } else {
    state.workspaceSelectedPath = null;
    state.workspacePreview = null;
  }
}

export async function refreshWorkspace(state: WorkspaceState) {
  await loadWorkspaceList(state, state.workspaceList?.currentPath ?? "");
}

export async function downloadWorkspaceFile(state: WorkspaceState, filePath: string) {
  if (!state.client || !state.connected || state.workspaceBusy) {
    return;
  }
  state.workspaceBusy = true;
  state.workspaceError = null;
  try {
    const res = await requestWorkspaceFile(state, filePath);
    downloadBlob(res.file.name, bytesFromBase64(res.file.contentBase64), res.file.mimeType);
  } catch (err) {
    state.workspaceError = getErrorMessage(err);
  } finally {
    state.workspaceBusy = false;
  }
}

export async function createWorkspaceDirectory(state: WorkspaceState, targetPath: string) {
  if (!state.client || !state.connected || state.workspaceBusy) {
    return;
  }
  state.workspaceBusy = true;
  state.workspaceError = null;
  try {
    await state.client.request("workspace.mkdir", { path: targetPath });
    await refreshWorkspace(state);
  } catch (err) {
    state.workspaceError = getErrorMessage(err);
  } finally {
    state.workspaceBusy = false;
  }
}

export async function renameWorkspaceEntry(
  state: WorkspaceState,
  entryPath: string,
  newName: string,
) {
  if (!state.client || !state.connected || state.workspaceBusy) {
    return;
  }
  state.workspaceBusy = true;
  state.workspaceError = null;
  try {
    await state.client.request("workspace.rename", { path: entryPath, newName });
    state.workspacePreview = null;
    state.workspaceSelectedPath = null;
    await refreshWorkspace(state);
  } catch (err) {
    state.workspaceError = getErrorMessage(err);
  } finally {
    state.workspaceBusy = false;
  }
}

export async function deleteWorkspaceEntry(state: WorkspaceState, entryPath: string) {
  if (!state.client || !state.connected || state.workspaceBusy) {
    return;
  }
  state.workspaceBusy = true;
  state.workspaceError = null;
  try {
    await state.client.request("workspace.delete", { path: entryPath });
    if (state.workspaceSelectedPath === entryPath) {
      state.workspaceSelectedPath = null;
      state.workspacePreview = null;
    }
    await refreshWorkspace(state);
  } catch (err) {
    state.workspaceError = getErrorMessage(err);
  } finally {
    state.workspaceBusy = false;
  }
}

export async function uploadWorkspaceFiles(state: WorkspaceState, files: FileList | File[]) {
  if (!state.client || !state.connected || state.workspaceBusy) {
    return;
  }
  const nextFiles = Array.from(files);
  if (nextFiles.length === 0) {
    return;
  }
  state.workspaceBusy = true;
  state.workspaceError = null;
  try {
    const currentPath = state.workspaceList?.currentPath ?? "";
    for (const [index, file] of nextFiles.entries()) {
      state.workspaceUpload = {
        currentFileName: file.name,
        currentFileLoaded: 0,
        currentFileTotal: file.size || null,
        currentFileIndex: index + 1,
        totalFiles: nextFiles.length,
      };
      await state.client.uploadWorkspaceFile({
        path: currentPath,
        file,
        onProgress: (progress: GatewayUploadProgress) => {
          state.workspaceUpload = {
            currentFileName: file.name,
            currentFileLoaded: progress.loaded,
            currentFileTotal: progress.total ?? (file.size || null),
            currentFileIndex: index + 1,
            totalFiles: nextFiles.length,
          };
        },
      });
    }
    await refreshWorkspace(state);
  } catch (err) {
    state.workspaceError = getErrorMessage(err);
  } finally {
    state.workspaceUpload = null;
    state.workspaceBusy = false;
  }
}
