import { html, nothing } from "lit";
import type { HubSkillMessageMap } from "../controllers/skills-hub.ts";
import { clampText } from "../format.ts";
import type { SkillHubItem, SkillHubPagination } from "../types.ts";
import { computeSkillMissing, renderSkillStatusChips } from "./skills-shared.ts";

export type SkillsHubProps = {
  connected: boolean;
  loading: boolean;
  /** 来自 skillsHub.catalog 的全量数据（已安装 + 可安装） */
  allSkills: SkillHubItem[];
  error: string | null;
  filter: string;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: HubSkillMessageMap;
  /** 分页信息（仅影响远程仓库技能） */
  pagination?: SkillHubPagination;
  /** 当前视图模式：卡片 or 表格 */
  viewMode: "card" | "table";
  /** 当前数据源：已安装技能 or 仓库技能 */
  dataSource: "installed" | "repo";
  /** 等待卸载确认的技能 key */
  uninstallConfirmKey: string | null;
  onFilterChange: (next: string) => void;
  onViewModeChange: (mode: "card" | "table") => void;
  onDataSourceChange: (source: "installed" | "repo") => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onInstallFromRepo?: (slug: string, downloadUrl: string, version?: string) => void;
  onDownload?: (slug: string, downloadUrl?: string) => void;
  onUninstallRequest: (skillKey: string) => void;
  onUninstallConfirm: (skillKey: string) => void;
  onUninstallCancel: () => void;
  onRequestUpdate?: () => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
};

// changelog 展开状态（skillKey/slug → 是否展开）
const _changelogOpen: Record<string, boolean> = {};

// 已安装技能前端分页状态
let _installedPage = 1;
let _installedPageSize = 12;
const _PAGE_SIZE_OPTIONS = [10, 12, 20, 50, 100];

// 轻量重渲染触发
function requestUpdate(props: SkillsHubProps) {
  props.onRequestUpdate?.();
  if (!props.onRequestUpdate) {
    props.onFilterChange(props.filter);
  }
}

// ─── 主渲染 ───────────────────────────────────────────────────────────────────

export function renderSkillsHub(props: SkillsHubProps) {
  const skills = props.allSkills;

  // 数据源过滤
  const sourceFiltered =
    props.dataSource === "installed"
      ? skills.filter((s) => s.installed)
      : skills.filter((s) => !s.installed);

  // 搜索过滤
  const filter = props.filter.trim().toLowerCase();
  const searched = filter
    ? sourceFiltered.filter((skill) =>
        [
          skill.name,
          skill.description,
          skill.source,
          skill.displayName ?? "",
          skill.summary ?? "",
          skill.slug ?? "",
          ...(skill.tags ?? []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(filter),
      )
    : sourceFiltered;

  // 已安装：前端分页
  // 每次搜索词变化时重置到第 1 页
  const isInstalled = props.dataSource === "installed";
  const totalInstalled = searched.length;
  const installedTotalPages = isInstalled
    ? Math.max(1, Math.ceil(totalInstalled / _installedPageSize))
    : 1;
  // 防止页码越界（搜索缩小结果后可能超界）
  if (isInstalled && _installedPage > installedTotalPages) {
    _installedPage = installedTotalPages;
  }
  const pageStart = isInstalled ? (_installedPage - 1) * _installedPageSize : 0;
  const pageEnd = isInstalled ? pageStart + _installedPageSize : searched.length;
  const visible = isInstalled ? searched.slice(pageStart, pageEnd) : searched;

  // 统计
  const installedCount = skills.filter((s) => s.installed).length;
  const repoCount = skills.filter((s) => !s.installed).length;

  return html`
    <div class="skills-hub" style="margin-bottom: -20px;">

      <!-- Toolbar -->
      <section class="card" style="margin-bottom: 8px; padding: 10px 16px;">
        <!-- Search + controls row -->
        <div
          style="
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
          "
        >
          <!-- Search input -->
          <label class="field" style="flex: 1; min-width: 180px; margin: 0;">
            <input
              id="skills-hub-search"
              .value=${props.filter}
              @input=${(e: Event) => {
                if (props.dataSource === "installed") {
                  // 已安装：实时过滤
                  _installedPage = 1;
                  props.onFilterChange((e.target as HTMLInputElement).value);
                }
                // 仓库模式：仅同步输入值，不触发查询（等待回车或点击按钮）
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter" && props.dataSource === "repo") {
                  const val = (e.target as HTMLInputElement).value;
                  _installedPage = 1;
                  props.onFilterChange(val);
                }
              }}
              @change=${(e: Event) => {
                // repo 模式 input blur 时同步值（不触发查询）
                if (props.dataSource === "repo") {
                  props.onFilterChange((e.target as HTMLInputElement).value);
                }
              }}
              placeholder=${props.dataSource === "repo" ? "搜索仓库技能…（回车或点击查询）" : "搜索技能…"}
              autocomplete="off"
              name="skills-hub-filter"
            />
          </label>

          <!-- 查询按钮（仓库模式：主动触发查询；已安装模式：触发过滤） -->
          <button
            class="btn btn--sm"
            ?disabled=${props.loading || !props.connected}
            @click=${() => {
              const input = document.getElementById("skills-hub-search") as HTMLInputElement | null;
              const val = input ? input.value : props.filter;
              _installedPage = 1;
              props.onFilterChange(val);
              if (props.dataSource === "repo") {
                props.onRefresh();
              }
            }}
          >
            ${props.dataSource === "repo" ? "查询" : "搜索"}
          </button>

          <!-- 刷新按钮 -->
          <button
            class="btn btn--sm"
            ?disabled=${props.loading || !props.connected}
            @click=${props.onRefresh}
            title="重新从网关加载技能数据"
          >
            ${props.loading ? "加载中…" : "刷新"}
          </button>

          <!-- Search result count -->
          <span class="muted" style="font-size: 12px; white-space: nowrap;">
            ${searched.length} 项
          </span>

          <!-- Data source radio group -->
          <div
            style="
              display: flex;
              align-items: center;
              background: var(--muted-bg, #f3f4f6);
              border: 1px solid var(--border-color, #e5e7eb);
              border-radius: 8px;
              padding: 2px;
              gap: 2px;
            "
          >
            ${renderSourceTab(props, "installed", `已安装 (${installedCount})`)}
            ${renderSourceTab(props, "repo", `仓库 (${repoCount})`)}
          </div>

          <!-- View mode toggle -->
          <div
            style="
              display: flex;
              align-items: center;
              background: var(--muted-bg, #f3f4f6);
              border: 1px solid var(--border-color, #e5e7eb);
              border-radius: 8px;
              padding: 2px;
              gap: 2px;
            "
          >
            ${renderViewModeBtn(props, "card", "⊞ 卡片")}
            ${renderViewModeBtn(props, "table", "☰ 列表")}
          </div>
        </div>

        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
      </section>

      <!-- Uninstall confirm dialog -->
      ${renderUninstallConfirm(props)}

      <!-- Content -->
      ${
        !props.connected && skills.length === 0
          ? html`
              <section class="card">
                <div class="muted">未连接到网关，请先连接以加载技能。</div>
              </section>
            `
          : html`
              <section
                class="card"
                style="
                  display: flex;
                  flex-direction: column;
                  max-height: calc(100vh - 230px);
                  min-height: 300px;
                  overflow: hidden;
                  padding: 14px 16px;
                "
              >
                <!-- 内容区：表格/卡片，超出时出现滚动条 -->
                <div style="flex: 1; overflow-y: auto; min-height: 0;">
                  ${
                    searched.length === 0
                      ? html`
                          <div class="muted" style="font-size: 13px; padding: 8px 0;">
                            ${
                              filter
                                ? "未找到符合条件的技能。"
                                : props.dataSource === "installed"
                                  ? "暂无已安装的技能。"
                                  : "暂无可安装的仓库技能。"
                            }
                          </div>
                        `
                      : props.viewMode === "card"
                        ? renderCardGrid(visible, props)
                        : renderTable(visible, props)
                  }
                </div>

                <!-- 底部工具栏：每页数量 + 分页导航（居中） -->
                ${
                  isInstalled && searched.length > 0
                    ? renderFrontendPagination(
                        _installedPage,
                        installedTotalPages,
                        totalInstalled,
                        props,
                      )
                    : props.dataSource === "repo"
                      ? renderPagination(props)
                      : nothing
                }
              </section>
            `
      }
    </div>
  `;
}

// ─── 辅助 UI 元素 ──────────────────────────────────────────────────────────────

function renderSourceTab(props: SkillsHubProps, source: "installed" | "repo", label: string) {
  const active = props.dataSource === source;
  return html`
    <button
      class="btn btn--sm"
      style="
        border-radius: 6px;
        border: none;
        padding: 4px 12px;
        font-size: 12px;
        font-weight: ${active ? "600" : "400"};
        background: ${active ? "var(--card-bg, #fff)" : "transparent"};
        color: ${active ? "var(--primary-color, #6366f1)" : "inherit"};
        box-shadow: ${active ? "0 1px 3px rgba(0,0,0,0.1)" : "none"};
        cursor: pointer;
        white-space: nowrap;
      "
      @click=${() => {
        _installedPage = 1;
        props.onDataSourceChange(source);
      }}
    >
      ${label}
    </button>
  `;
}

function renderViewModeBtn(props: SkillsHubProps, mode: "card" | "table", label: string) {
  const active = props.viewMode === mode;
  return html`
    <button
      class="btn btn--sm"
      style="
        border-radius: 6px;
        border: none;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: ${active ? "600" : "400"};
        background: ${active ? "var(--card-bg, #fff)" : "transparent"};
        color: ${active ? "var(--primary-color, #6366f1)" : "inherit"};
        box-shadow: ${active ? "0 1px 3px rgba(0,0,0,0.1)" : "none"};
        cursor: pointer;
      "
      @click=${() => props.onViewModeChange(mode)}
    >
      ${label}
    </button>
  `;
}

function renderUninstallConfirm(props: SkillsHubProps) {
  const { uninstallConfirmKey } = props;
  if (!uninstallConfirmKey) {
    return nothing;
  }
  const skill = props.allSkills.find(
    (s) => s.skillKey === uninstallConfirmKey || s.slug === uninstallConfirmKey,
  );
  const displayName = skill?.displayName || skill?.name || uninstallConfirmKey;
  return html`
    <div
      style="
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      "
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          props.onUninstallCancel();
        }
      }}
    >
      <div
        class="card"
        style="
          max-width: 400px;
          width: 90%;
          padding: 24px;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        "
      >
        <div class="card-title" style="margin-bottom: 8px;">确认卸载</div>
        <div style="margin-bottom: 20px; color: var(--text-color); font-size: 14px;">
          确定要卸载技能 <strong>${displayName}</strong> 吗？此操作将删除本地技能文件。
        </div>
        <div class="row" style="gap: 8px; justify-content: flex-end;">
          <button class="btn" @click=${props.onUninstallCancel}>取消</button>
          <button
            class="btn danger"
            ?disabled=${props.busyKey === uninstallConfirmKey}
            @click=${() => props.onUninstallConfirm(uninstallConfirmKey)}
          >
            ${props.busyKey === uninstallConfirmKey ? "卸载中…" : "确认卸载"}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── 卡片网格视图 ──────────────────────────────────────────────────────────────

function renderCardGrid(skills: SkillHubItem[], props: SkillsHubProps) {
  return html`
    <div
      style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      "
    >
      ${skills.map((skill) => renderCard(skill, props))}
    </div>
  `;
}

function renderCard(skill: SkillHubItem, props: SkillsHubProps) {
  const busy = props.busyKey === skill.skillKey || props.busyKey === skill.slug;
  const message = props.messages[skill.skillKey] ?? props.messages[skill.slug ?? ""] ?? null;
  const displayTitle = skill.displayName || skill.name;
  const repoVersion = skill.latestVersion?.version;
  const canInstallFromRepo =
    !skill.installed && skill.source === "repo" && Boolean(skill.latestVersion?.downloadUrl);
  const canInstallLocal =
    !skill.installed && skill.install.length > 0 && skill.missing.bins.length > 0;
  const missing = computeSkillMissing(skill);

  return html`
    <div
      class="card"
      style="
        display: flex;
        flex-direction: column;
        gap: 10px;
        opacity: ${skill.installed && skill.disabled ? "0.65" : "1"};
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 10px;
        padding: 16px;
        position: relative;
      "
    >
      <!-- Title row -->
      <div style="display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 14px; line-height: 1.4;">
            ${skill.emoji ? `${skill.emoji} ` : ""}${displayTitle}
          </div>
          ${
            repoVersion
              ? html`<span class="muted" style="font-size: 11px;">v${repoVersion}</span>`
              : nothing
          }
        </div>
        ${renderBadges(skill)}
      </div>

      <!-- Description -->
      <div class="muted" style="font-size: 13px; flex: 1; line-height: 1.5;">
        ${clampText(skill.summary ?? skill.description, 120)}
      </div>

      <!-- Status chips (installed skills) -->
      ${skill.installed ? renderSkillStatusChips({ skill, showBundledBadge: false }) : nothing}

      <!-- Repo meta: downloads + changelog -->
      ${renderRepoMeta(skill, props)}

      <!-- Missing deps -->
      ${
        missing.length > 0
          ? html`<div class="muted" style="font-size: 11px;">缺少依赖：${missing.join(", ")}</div>`
          : nothing
      }

      <!-- Message -->
      ${
        message
          ? html`<div
              style="font-size: 12px; color: ${
                message.kind === "error"
                  ? "var(--danger-color, #d14343)"
                  : "var(--success-color, #0a7f5a)"
              };"
            >${message.message}</div>`
          : nothing
      }

      <!-- Action buttons -->
      <div class="row" style="gap: 6px; flex-wrap: wrap; margin-top: auto;">
        ${renderActionButtons(skill, props, busy, canInstallFromRepo, canInstallLocal)}
      </div>
    </div>
  `;
}

// ─── 表格视图 ─────────────────────────────────────────────────────────────────

function renderTable(skills: SkillHubItem[], props: SkillsHubProps) {
  return html`
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 1px solid var(--border-color, #e5e7eb);">
            <th style="text-align: left; padding: 8px 12px; font-weight: 600; color: var(--muted-color);">名称</th>
            <th style="text-align: left; padding: 8px 12px; font-weight: 600; color: var(--muted-color);">描述</th>
            <th style="text-align: center; padding: 8px 12px; font-weight: 600; color: var(--muted-color);">版本</th>
            <th style="text-align: center; padding: 8px 12px; font-weight: 600; color: var(--muted-color);">状态</th>
            <th style="text-align: right; padding: 8px 12px; font-weight: 600; color: var(--muted-color);">操作</th>
          </tr>
        </thead>
        <tbody>
          ${skills.map((skill, i) => renderTableRow(skill, props, i))}
        </tbody>
      </table>
    </div>
  `;
}

function renderTableRow(skill: SkillHubItem, props: SkillsHubProps, index: number) {
  const busy = props.busyKey === skill.skillKey || props.busyKey === skill.slug;
  const message = props.messages[skill.skillKey] ?? props.messages[skill.slug ?? ""] ?? null;
  const displayTitle = skill.displayName || skill.name;
  const repoVersion = skill.latestVersion?.version;
  const canInstallFromRepo =
    !skill.installed && skill.source === "repo" && Boolean(skill.latestVersion?.downloadUrl);
  const canInstallLocal =
    !skill.installed && skill.install.length > 0 && skill.missing.bins.length > 0;

  return html`
    <tr
      style="
        border-bottom: 1px solid var(--border-color, #e5e7eb);
        background: ${index % 2 === 0 ? "transparent" : "var(--muted-bg, #f9fafb)"};
        opacity: ${skill.installed && skill.disabled ? "0.65" : "1"};
      "
    >
      <!-- Name -->
      <td style="padding: 10px 12px; vertical-align: middle;">
        <div style="font-weight: 500;">
          ${skill.emoji ? `${skill.emoji} ` : ""}${displayTitle}
        </div>
        ${renderBadges(skill)}
        ${
          message
            ? html`<div
                style="font-size: 11px; margin-top: 2px; color: ${
                  message.kind === "error"
                    ? "var(--danger-color, #d14343)"
                    : "var(--success-color, #0a7f5a)"
                };"
              >${message.message}</div>`
            : nothing
        }
      </td>

      <!-- Description -->
      <td style="padding: 10px 12px; vertical-align: middle; max-width: 280px;">
        <span class="muted">${clampText(skill.summary ?? skill.description, 100)}</span>
      </td>

      <!-- Version -->
      <td style="padding: 10px 12px; vertical-align: middle; text-align: center; white-space: nowrap;">
        <div style="display: flex; align-items: center; justify-content: center;">
          ${
            repoVersion
              ? html`<span class="muted">v${repoVersion}</span>`
              : html`
                  <span class="muted">—</span>
                `
          }
        </div>
      </td>

      <!-- Status -->
      <td style="padding: 10px 12px; vertical-align: middle; text-align: center;">
        <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px;">
          ${
            skill.installed
              ? html`${renderSkillStatusChips({ skill, showBundledBadge: false })}`
              : html`
                  <span class="muted" style="font-size: 11px">未安装</span>
                `
          }
        </div>
      </td>

      <!-- Actions -->
      <td style="padding: 10px 12px; vertical-align: middle; text-align: right; white-space: nowrap;">
        <div style="display: flex; gap: 4px; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
          ${renderActionButtons(skill, props, busy, canInstallFromRepo, canInstallLocal)}
        </div>
      </td>
    </tr>
  `;
}

// ─── 共用组件 ─────────────────────────────────────────────────────────────────

function renderBadges(skill: SkillHubItem) {
  const badges = [];

  if (skill.installed) {
    badges.push(html`
      <span
        style="
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 999px;
          background: var(--success-color-muted, #d1fae5);
          color: var(--success-color, #0a7f5a);
          font-weight: 600;
          white-space: nowrap;
        "
        >已安装</span
      >
    `);
  }

  if (skill.bundled) {
    badges.push(html`
      <span
        style="
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 999px;
          background: var(--muted-bg, #f3f4f6);
          color: var(--muted-color);
          font-weight: 500;
          white-space: nowrap;
        "
        >内置</span
      >
    `);
  }

  if (badges.length === 0) {
    return nothing;
  }

  return html`<div class="row" style="gap: 4px; flex-wrap: wrap; margin-top: 4px;">${badges}</div>`;
}

function renderActionButtons(
  skill: SkillHubItem,
  props: SkillsHubProps,
  busy: boolean,
  canInstallFromRepo: boolean,
  canInstallLocal: boolean,
) {
  const parts = [];

  // Installed skill actions: enable/disable + uninstall
  if (skill.installed) {
    parts.push(html`
      <button
        class="btn btn--sm"
        ?disabled=${busy}
        @click=${() => props.onToggle(skill.skillKey, skill.disabled)}
      >
        ${skill.disabled ? "启用" : "禁用"}
      </button>
    `);
    // Only managed (non-bundled) skills can be uninstalled
    if (!skill.bundled) {
      parts.push(html`
        <button
          class="btn btn--sm danger"
          ?disabled=${busy}
          @click=${() => props.onUninstallRequest(skill.skillKey)}
        >
          卸载
        </button>
      `);
    }
  }

  // Repo skill actions: install + download
  if (!skill.installed) {
    if (canInstallFromRepo && props.onInstallFromRepo) {
      parts.push(html`
        <button
          class="btn btn--sm primary"
          ?disabled=${busy}
          @click=${() =>
            props.onInstallFromRepo!(
              skill.slug ?? skill.name,
              skill.latestVersion!.downloadUrl,
              skill.latestVersion?.version,
            )}
        >
          ${busy ? "安装中…" : "安装"}
        </button>
      `);
    }
    if (canInstallLocal) {
      parts.push(html`
        <button
          class="btn btn--sm primary"
          ?disabled=${busy}
          @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
        >
          ${busy ? "安装中…" : skill.install[0].label}
        </button>
      `);
    }
    // Download .tar.gz button
    if (props.onDownload && (skill.slug || skill.name)) {
      parts.push(html`
        <button
          class="btn btn--sm"
          @click=${() => props.onDownload!(skill.slug ?? skill.name, skill.latestVersion?.downloadUrl)}
          title="下载 .tar.gz 到本地"
        >
          下载
        </button>
      `);
    }
  }

  // Installed repo skill also gets download
  if (
    skill.installed &&
    skill.source === "repo" &&
    props.onDownload &&
    (skill.slug || skill.name)
  ) {
    parts.push(html`
      <button
        class="btn btn--sm"
        @click=${() => props.onDownload!(skill.slug ?? skill.name, skill.latestVersion?.downloadUrl)}
        title="下载 .tar.gz 到本地"
      >
        下载
      </button>
    `);
  }

  return parts;
}

/** Render repo-specific metadata (downloads, changelog) */
function renderRepoMeta(skill: SkillHubItem, props: SkillsHubProps) {
  if (skill.source !== "repo") {
    return nothing;
  }
  const downloads = skill.downloads;
  const changelog = skill.latestVersion?.changelog;
  const changelogKey = skill.skillKey || skill.slug || skill.name;
  const isOpen = Boolean(_changelogOpen[changelogKey]);

  if (downloads === undefined && !changelog) {
    return nothing;
  }

  return html`
    <div style="margin-top: 4px;">
      ${
        downloads !== undefined
          ? html`<span class="muted" style="font-size: 11px; margin-right: 10px;">
              ↓ ${downloads.toLocaleString()} 次下载
            </span>`
          : nothing
      }
      ${
        changelog
          ? html`
              <button
                class="btn btn--sm"
                style="font-size: 11px; padding: 1px 8px;"
                @click=${() => {
                  _changelogOpen[changelogKey] = !isOpen;
                  requestUpdate(props);
                }}
              >
                ${isOpen ? "▲ 收起" : "▼ 更新说明"}
              </button>
              ${
                isOpen
                  ? html`<div
                      class="muted"
                      style="
                        margin-top: 6px;
                        font-size: 12px;
                        white-space: pre-wrap;
                        background: var(--muted-bg, #f3f4f6);
                        border-radius: 6px;
                        padding: 8px 10px;
                        line-height: 1.6;
                      "
                    >${changelog}</div>`
                  : nothing
              }
            `
          : nothing
      }
    </div>
  `;
}

/** Render pagination controls */
function renderPagination(props: SkillsHubProps) {
  const { pagination, onPageChange, onPageSizeChange, loading } = props;
  if (!pagination || !onPageChange) {
    return nothing;
  }

  const { page, pageSize, total, totalPages } = pagination;
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return html`
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        flex-wrap: wrap;
        flex-shrink: 0;
        padding: 10px 0 2px;
        margin-top: 8px;
        border-top: 1px solid var(--border-color, #e5e7eb);
      "
    >
      <!-- 每页显示数量 -->
      <span class="muted" style="font-size: 12px;">每页</span>
      <select
        style="
          font-size: 12px;
          padding: 2px 6px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 6px;
          background: var(--card-bg, #fff);
          color: var(--text-color);
          cursor: pointer;
        "
        .value=${String(pageSize)}
        @change=${(e: Event) => {
          const next = Number((e.target as HTMLSelectElement).value);
          onPageSizeChange?.(next);
        }}
      >
        ${_PAGE_SIZE_OPTIONS.map(
          (n) => html`<option value=${n} ?selected=${n === pageSize}>${n} 条</option>`,
        )}
      </select>

      <!-- 分隔 -->
      <span class="muted" style="font-size: 12px; opacity: 0.4;">|</span>

      <!-- 上一页 -->
      <button
        class="btn btn--sm"
        ?disabled=${!canPrev || loading}
        @click=${() => onPageChange(page - 1)}
      >
        上一页
      </button>

      <!-- 页码 / 条数信息 -->
      <span class="muted" style="font-size: 12px; white-space: nowrap;">
        第 ${page} / ${totalPages} 页 &nbsp;·&nbsp; ${start}–${end} / ${total} 条
      </span>

      <!-- 下一页 -->
      <button
        class="btn btn--sm"
        ?disabled=${!canNext || loading}
        @click=${() => onPageChange(page + 1)}
      >
        下一页
      </button>
    </div>
  `;
}

/** Render frontend (client-side) pagination for installed skills */
function renderFrontendPagination(
  page: number,
  totalPages: number,
  total: number,
  props: SkillsHubProps,
) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const start = (page - 1) * _installedPageSize + 1;
  const end = Math.min(page * _installedPageSize, total);

  return html`
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        flex-wrap: wrap;
        flex-shrink: 0;
        padding: 10px 0 2px;
        margin-top: 8px;
        border-top: 1px solid var(--border-color, #e5e7eb);
      "
    >
      <!-- 每页显示数量 -->
      <span class="muted" style="font-size: 12px;">每页</span>
      <select
        style="
          font-size: 12px;
          padding: 2px 6px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 6px;
          background: var(--card-bg, #fff);
          color: var(--text-color);
          cursor: pointer;
        "
        .value=${String(_installedPageSize)}
        @change=${(e: Event) => {
          _installedPageSize = Number((e.target as HTMLSelectElement).value);
          _installedPage = 1;
          requestUpdate(props);
        }}
      >
        ${_PAGE_SIZE_OPTIONS.map(
          (n) => html`<option value=${n} ?selected=${n === _installedPageSize}>${n} 条</option>`,
        )}
      </select>

      <!-- 分隔 -->
      <span class="muted" style="font-size: 12px; opacity: 0.4;">|</span>

      <!-- 上一页 -->
      <button
        class="btn btn--sm"
        ?disabled=${!canPrev}
        @click=${() => {
          _installedPage = page - 1;
          requestUpdate(props);
        }}
      >
        上一页
      </button>

      <!-- 页码 / 条数信息 -->
      <span class="muted" style="font-size: 12px; white-space: nowrap;">
        第 ${page} / ${totalPages} 页 &nbsp;·&nbsp; ${start}–${end} / ${total} 条
      </span>

      <!-- 下一页 -->
      <button
        class="btn btn--sm"
        ?disabled=${!canNext}
        @click=${() => {
          _installedPage = page + 1;
          requestUpdate(props);
        }}
      >
        下一页
      </button>
    </div>
  `;
}
