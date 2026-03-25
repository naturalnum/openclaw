import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkspacePreviewState, WorkspaceUploadState } from "../controllers/workspace.ts";
import { icons } from "../icons.ts";
import type { WorkspaceEntry, WorkspaceListResult } from "../types.ts";
import "../components/resizable-divider.ts";

export type FilesProps = {
  workspaceLoading: boolean;
  workspaceBusy: boolean;
  workspaceError: string | null;
  workspaceList: WorkspaceListResult | null;
  workspaceSelectedPath: string | null;
  workspacePreview: WorkspacePreviewState | null;
  workspaceUpload: WorkspaceUploadState | null;
  workspaceSplitRatio: number;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onRefreshWorkspace: () => void;
  onSelectWorkspaceEntry: (entry: WorkspaceEntry) => void;
  onOpenWorkspaceEntry: (entry: WorkspaceEntry) => void;
  onNavigateWorkspace: (path: string) => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onDownloadWorkspaceFile: (path: string) => void;
  onUploadWorkspaceFiles: (files: FileList | File[]) => void;
  onCreateWorkspaceDirectory: (path: string) => void;
  onRenameWorkspaceEntry: (path: string, newName: string) => void;
  onDeleteWorkspaceEntry: (path: string) => void;
  onSplitRatioChange: (ratio: number) => void;
};

function buildBreadcrumbs(list: WorkspaceListResult | null) {
  const currentPath = list?.currentPath ?? "";
  const parts = currentPath ? currentPath.split("/").filter(Boolean) : [];
  const breadcrumbs = [{ label: t("files.root"), path: "" }];
  for (let i = 0; i < parts.length; i++) {
    breadcrumbs.push({
      label: parts[i],
      path: parts.slice(0, i + 1).join("/"),
    });
  }
  return breadcrumbs;
}

function formatBytes(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return "—";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(value?: number) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

function previewTitle(preview: WorkspacePreviewState | null, selectedEntry: WorkspaceEntry | null) {
  if (!preview) {
    if (selectedEntry?.kind === "directory") {
      return t("files.preview.folderHint");
    }
    return t("files.preview.empty");
  }
  if (preview.kind === "none") {
    return t("files.preview.unavailable");
  }
  return null;
}

function renderWorkspacePreview(
  preview: WorkspacePreviewState | null,
  selectedEntry: WorkspaceEntry | null,
) {
  const title = previewTitle(preview, selectedEntry);
  if (title) {
    return html`<div class="muted">${title}</div>`;
  }
  if (!preview) {
    return nothing;
  }
  if (preview.kind === "text") {
    return html`<pre class="workspace-preview__text">${preview.textContent ?? ""}</pre>`;
  }
  if (preview.kind === "image") {
    return html`<img class="workspace-preview__image" src=${preview.dataUrl ?? ""} alt=${preview.name} />`;
  }
  if (preview.kind === "pdf") {
    return html`<iframe class="workspace-preview__frame" src=${preview.dataUrl ?? ""} title=${preview.name}></iframe>`;
  }
  return html`<div class="muted">${t("files.preview.unavailable")}</div>`;
}

function renderWorkspaceUploadStatus(upload: WorkspaceUploadState | null) {
  if (!upload) {
    return nothing;
  }
  const total = upload.currentFileTotal;
  const loaded = Math.min(upload.currentFileLoaded, total ?? upload.currentFileLoaded);
  const percent = total && total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  return html`
    <div class="workspace-upload">
      <div class="workspace-upload__header">
        <div class="workspace-upload__title">${t("files.uploadStatus.uploading")}</div>
        <div class="workspace-upload__counter">${upload.currentFileIndex}/${upload.totalFiles}</div>
      </div>
      <div class="workspace-upload__name mono" title=${upload.currentFileName}>${upload.currentFileName}</div>
      <div
        class="workspace-upload__bar"
        role="progressbar"
        aria-label=${t("files.uploadStatus.uploading")}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${percent ?? 0}
      >
        <span class="workspace-upload__fill" style=${`width: ${percent ?? 100}%`}></span>
      </div>
      <div class="workspace-upload__meta">
        <span>
          ${
            total
              ? t("files.uploadStatus.progressDetailed", {
                  loaded: formatBytes(loaded),
                  total: formatBytes(total),
                })
              : t("files.uploadStatus.progressLoaded", { loaded: formatBytes(loaded) })
          }
        </span>
        <span>${percent == null ? t("files.uploadStatus.preparing") : `${percent}%`}</span>
      </div>
    </div>
  `;
}

export function renderFiles(props: FilesProps) {
  const breadcrumbs = buildBreadcrumbs(props.workspaceList);
  const currentPath = props.workspaceList?.currentPath ?? "";
  const selectedEntry =
    props.workspaceList?.entries.find((entry) => entry.path === props.workspaceSelectedPath) ??
    null;

  return html`
    <section class="card workspace-browser">
      <div class="workspace-browser__toolbar">
        <div class="workspace-browser__nav">
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${props.workspaceLoading || props.workspaceBusy || !props.canNavigateBack}
            @click=${props.onNavigateBack}
          >
            ${t("files.actions.back")}
          </button>
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${props.workspaceLoading || props.workspaceBusy || !props.canNavigateForward}
            @click=${props.onNavigateForward}
          >
            ${t("files.actions.forward")}
          </button>
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${props.workspaceLoading || props.workspaceBusy || props.workspaceList?.parentPath == null}
            @click=${() => props.onNavigateWorkspace(props.workspaceList?.parentPath ?? "")}
          >
            ${t("files.actions.up")}
          </button>
          ${breadcrumbs.map(
            (crumb, index) => html`
              <button
                class="btn btn--sm"
                type="button"
                ?disabled=${props.workspaceLoading || props.workspaceBusy}
                @click=${() => props.onNavigateWorkspace(crumb.path)}
                title=${crumb.label}
              >
                ${crumb.label}
              </button>
              ${
                index < breadcrumbs.length - 1
                  ? html`
                      <span class="muted">›</span>
                    `
                  : nothing
              }
            `,
          )}
        </div>
        <div class="workspace-browser__actions">
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${props.workspaceLoading || props.workspaceBusy}
            @click=${() => {
              const name = window.prompt(t("files.prompts.newFolder"));
              if (!name) {
                return;
              }
              const normalized = name.trim();
              if (!normalized) {
                return;
              }
              const targetPath = currentPath ? `${currentPath}/${normalized}` : normalized;
              props.onCreateWorkspaceDirectory(targetPath);
            }}
          >
            ${t("files.actions.newFolder")}
          </button>
          <label class="btn btn--sm workspace-browser__upload">
            ${t("files.actions.upload")}
            <input
              type="file"
              multiple
              @change=${(event: Event) => {
                const target = event.target as HTMLInputElement;
                if (target.files && target.files.length > 0) {
                  props.onUploadWorkspaceFiles(target.files);
                  target.value = "";
                }
              }}
            />
          </label>
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${props.workspaceLoading || props.workspaceBusy}
            @click=${props.onRefreshWorkspace}
          >
            ${t("common.refresh")}
          </button>
        </div>
      </div>

      ${props.workspaceError ? html`<div class="callout danger">${props.workspaceError}</div>` : nothing}

      <div
        class="workspace-browser__layout"
        style=${`--workspace-list-width: ${props.workspaceSplitRatio * 100}%`}
      >
        <div class="workspace-browser__list">
          <div class="workspace-browser__header">
            <div>${t("files.table.name")}</div>
            <div>${t("files.table.size")}</div>
            <div>${t("files.table.updated")}</div>
            <div>${t("files.table.actions")}</div>
          </div>
          ${props.workspaceLoading ? html`<div class="muted">${t("files.status.loading")}</div>` : nothing}
          ${
            props.workspaceList?.entries.length
              ? props.workspaceList.entries.map(
                  (entry) => html`
                    <div
                      class="workspace-entry ${props.workspaceSelectedPath === entry.path ? "workspace-entry--selected" : ""}"
                      @click=${() => props.onSelectWorkspaceEntry(entry)}
                      @dblclick=${() => {
                        if (entry.kind === "directory") {
                          props.onOpenWorkspaceEntry(entry);
                        }
                      }}
                    >
                      <button
                        class="workspace-entry__name"
                        type="button"
                        @click=${() => {
                          props.onSelectWorkspaceEntry(entry);
                          if (entry.kind === "file") {
                            props.onOpenWorkspaceEntry(entry);
                          }
                        }}
                      >
                        <span class="workspace-entry__icon">
                          ${
                            entry.kind === "directory"
                              ? icons.folder
                              : entry.previewKind === "image"
                                ? icons.image
                                : icons.fileText
                          }
                        </span>
                        <span class="workspace-entry__label" title=${entry.name}>${entry.name}</span>
                      </button>
                      <div>${formatBytes(entry.size)}</div>
                      <div>${formatUpdatedAt(entry.updatedAtMs)}</div>
                      <div class="workspace-entry__actions">
                        ${
                          entry.kind === "file"
                            ? html`
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  ?disabled=${props.workspaceBusy}
                                  @click=${(event: Event) => {
                                    event.stopPropagation();
                                    props.onDownloadWorkspaceFile(entry.path);
                                  }}
                                >
                                  ${t("files.actions.download")}
                                </button>
                              `
                            : nothing
                        }
                        <button
                          class="btn btn--sm"
                          type="button"
                          ?disabled=${props.workspaceBusy}
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            const nextName = window.prompt(t("files.prompts.rename"), entry.name);
                            if (!nextName || nextName.trim() === entry.name) {
                              return;
                            }
                            props.onRenameWorkspaceEntry(entry.path, nextName.trim());
                          }}
                        >
                          ${t("files.actions.rename")}
                        </button>
                        <button
                          class="btn btn--sm danger"
                          type="button"
                          ?disabled=${props.workspaceBusy}
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            const confirmed = window.confirm(
                              t("files.prompts.delete", { name: entry.name }),
                            );
                            if (!confirmed) {
                              return;
                            }
                            props.onDeleteWorkspaceEntry(entry.path);
                          }}
                        >
                          ${t("files.actions.delete")}
                        </button>
                      </div>
                    </div>
                  `,
                )
              : html`<div class="muted">${t("files.status.empty")}</div>`
          }
        </div>

        <resizable-divider
          class="workspace-browser__divider"
          .splitRatio=${props.workspaceSplitRatio}
          .minRatio=${0.35}
          .maxRatio=${0.72}
          @resize=${(event: CustomEvent) => props.onSplitRatioChange(event.detail.splitRatio)}
        ></resizable-divider>

        <div class="workspace-preview-pane">
          ${renderWorkspaceUploadStatus(props.workspaceUpload)}
          <div class="workspace-preview">
            <div class="workspace-preview__meta">
              <div class="workspace-preview__name">
                ${props.workspacePreview?.name ?? selectedEntry?.name ?? t("files.preview.title")}
              </div>
              ${
                props.workspacePreview
                  ? html`
                      <div class="muted">
                        ${props.workspacePreview.mimeType} · ${formatBytes(props.workspacePreview.size)}
                      </div>
                    `
                  : nothing
              }
            </div>
            ${renderWorkspacePreview(props.workspacePreview, selectedEntry)}
          </div>
        </div>
      </div>
    </section>
  `;
}
