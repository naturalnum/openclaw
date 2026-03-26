import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import type {
  SkillsRegistryCatalogItem,
  SkillsRegistryCategory,
  SkillsRegistryInstallFilter,
  SkillsRegistryPagination,
  SkillsRegistrySortBy,
} from "../types.ts";
import type { SkillMessageMap } from "./controller.ts";

export type SkillsMarketProps = {
  connected: boolean;
  loading: boolean;
  archiveBusy: boolean;
  items: SkillsRegistryCatalogItem[];
  categories: SkillsRegistryCategory[];
  pagination: SkillsRegistryPagination;
  error: string | null;
  notice: SkillMessageMap[string] | null;
  filter: string;
  selectedCategory: string | null;
  sortBy: SkillsRegistrySortBy;
  installFilter: SkillsRegistryInstallFilter;
  busyKey: string | null;
  messages: SkillMessageMap;
  registryBaseUrl: string | null;
  onSearchChange: (next: string) => void;
  onCategoryChange: (next: string | null) => void;
  onSortChange: (next: SkillsRegistrySortBy) => void;
  onInstallFilterChange: (next: SkillsRegistryInstallFilter) => void;
  onRefresh: () => void;
  onPageChange: (next: number) => void;
  onToggleInstall: (item: SkillsRegistryCatalogItem) => void;
  onImportArchive: (file: File) => void;
  onDismissNotice: () => void;
  onDismissError: () => void;
};

function formatTotal(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value < 1000 ? 0 : 1,
  }).format(value);
}

function renderCategoryChip(
  category: SkillsRegistryCategory,
  selected: boolean,
  onSelect: (next: string | null) => void,
) {
  const background = selected
    ? (category.bgColor ?? "rgba(22, 163, 74, 0.12)")
    : "var(--surface-elevated, rgba(15, 23, 42, 0.04))";
  const color = selected ? (category.textColor ?? "#166534") : "var(--text-color, #111827)";
  return html`
    <button
      class="btn"
      style=${`border-radius: 999px; background: ${background}; color: ${color}; border: 1px solid rgba(15, 23, 42, 0.08);`}
      @click=${() => onSelect(selected ? null : category.id)}
    >
      ${category.icon ? `${category.icon} ` : ""}${category.name}
    </button>
  `;
}

function renderInstallFilterButton(params: {
  value: SkillsRegistryInstallFilter;
  active: boolean;
  label: string;
  onSelect: (next: SkillsRegistryInstallFilter) => void;
}) {
  return html`
    <button
      class="btn ${params.active ? "primary" : ""}"
      style="border-radius: 999px;"
      @click=${() => params.onSelect(params.value)}
    >
      ${params.label}
    </button>
  `;
}

function renderPagination(props: SkillsMarketProps) {
  if (props.pagination.totalPages <= 1) {
    return nothing;
  }
  const current = props.pagination.page;
  const pages = Array.from({ length: props.pagination.totalPages }, (_, index) => index + 1).filter(
    (page) => page === 1 || page === props.pagination.totalPages || Math.abs(page - current) <= 1,
  );
  const deduped = pages.filter((page, index) => index === 0 || page !== pages[index - 1]);
  return html`
    <div class="row" style="justify-content: center; gap: 8px; margin-top: 20px; flex-wrap: wrap;">
      <button class="btn" ?disabled=${current <= 1} @click=${() => props.onPageChange(current - 1)}>
        上一页
      </button>
      ${deduped.map(
        (page, index) => html`
          ${
            index > 0 && deduped[index - 1] !== page - 1
              ? html`
                  <span class="muted" style="align-self: center">…</span>
                `
              : nothing
          }
          <button
            class="btn ${page === current ? "primary" : ""}"
            @click=${() => props.onPageChange(page)}
          >
            ${page}
          </button>
        `,
      )}
      <button
        class="btn"
        ?disabled=${current >= props.pagination.totalPages}
        @click=${() => props.onPageChange(current + 1)}
      >
        下一页
      </button>
    </div>
  `;
}

function renderInstallToggle(props: SkillsMarketProps, item: SkillsRegistryCatalogItem) {
  const busy = props.busyKey === item.slug;
  const installed = item.installState.installed;
  const isLocalInstall = installed && item.installState.source === "directory";
  const disabled = busy || (installed && !item.installState.canUninstall);
  const thumbOffset = installed ? 20 : 0;
  const label = installed ? (isLocalInstall ? "本地" : "已安装") : "安装";
  const background = disabled
    ? "rgba(148, 163, 184, 0.55)"
    : installed
      ? isLocalInstall
        ? "linear-gradient(135deg, #7dd3fc, #38bdf8)"
        : "linear-gradient(135deg, #22c55e, #15803d)"
      : "rgba(148, 163, 184, 0.75)";
  const toggleTitle =
    installed && item.installState.canUninstall
      ? isLocalInstall
        ? "卸载本地技能"
        : "卸载技能"
      : "安装技能";
  return html`
    <div style="display: inline-flex; align-items: center; gap: 10px;">
      <span class="muted" style="font-size: 12px; white-space: nowrap;">${busy ? "处理中…" : label}</span>
      <button
        type="button"
        aria-label=${installed ? "卸载技能" : "安装技能"}
        aria-pressed=${String(installed)}
        class="btn"
        style=${`padding: 0; width: 48px; height: 28px; border-radius: 999px; border: none; background: ${background}; position: relative; cursor: ${disabled ? "not-allowed" : "pointer"};`}
        ?disabled=${disabled}
        title=${toggleTitle}
        @click=${() => props.onToggleInstall(item)}
      >
        <span
          style=${`position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; border-radius: 999px; background: #fff; transform: translateX(${thumbOffset}px); transition: transform 0.18s ease; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.2);`}
        ></span>
      </button>
    </div>
  `;
}

function renderMetaIcon(kind: "downloads" | "installs" | "version") {
  if (kind === "downloads") {
    return html`
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M8 2.5v6.5"></path>
        <path d="M5.5 6.5 8 9l2.5-2.5"></path>
        <path d="M3 11.5h10"></path>
      </svg>
    `;
  }
  if (kind === "installs") {
    return html`
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M8 2.5 12 4.75 8 7 4 4.75 8 2.5Z"></path>
        <path d="M4 4.75v4.5L8 11.5l4-2.25v-4.5"></path>
        <path d="M8 7v4.5"></path>
      </svg>
    `;
  }
  return html`
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5.5 5 2.75 8l2.75 3"></path>
      <path d="M10.5 5 13.25 8l-2.75 3"></path>
    </svg>
  `;
}

function renderInlineMetaItem(params: {
  kind: "downloads" | "installs" | "version";
  value: string;
  title: string;
}) {
  return html`
    <div
      title=${params.title}
      style="display: inline-flex; align-items: center; gap: 6px; color: rgba(71, 85, 105, 0.92);"
    >
      <span
        aria-hidden="true"
        style="display: inline-flex; align-items: center; justify-content: center; color: rgba(100, 116, 139, 0.95);"
      >
        ${renderMetaIcon(params.kind)}
      </span>
      <span style="font-size: 13px; font-weight: 500; color: inherit;">${params.value}</span>
    </div>
  `;
}

function renderMetaRow(item: SkillsRegistryCatalogItem) {
  return html`
    <div
      class="muted"
      style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 13px;"
    >
      ${renderInlineMetaItem({
        kind: "downloads",
        value: formatCompactNumber(item.downloads),
        title: `${formatTotal(item.downloads)} downloads`,
      })}
      ${renderInlineMetaItem({
        kind: "installs",
        value: formatCompactNumber(item.installs),
        title: `${formatTotal(item.installs)} installs`,
      })}
      ${renderInlineMetaItem({
        kind: "version",
        value: item.version ? item.version : "-",
        title: item.version ? `Version ${item.version}` : "Version unknown",
      })}
      ${
        item.installState.installedVersion && item.installState.installedVersion !== item.version
          ? html`
              <span
                class="pill pill--sm pill--ok"
                style="font-size: 11px; letter-spacing: 0.02em;"
              >
                Installed ${item.installState.installedVersion}
              </span>
            `
          : nothing
      }
    </div>
  `;
}

function renderDismissibleCallout(params: {
  tone: "danger" | "success";
  message: string;
  onClose: () => void;
}) {
  return html`
    <div
      class="callout ${params.tone}"
      style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;"
    >
      <div style="min-width: 0; flex: 1;">${params.message}</div>
      <button
        class="btn"
        type="button"
        aria-label="关闭提示"
        title="关闭"
        style="padding: 2px 10px; min-height: 28px; border-radius: 999px;"
        @click=${params.onClose}
      >
        关闭
      </button>
    </div>
  `;
}

function renderCard(props: SkillsMarketProps, item: SkillsRegistryCatalogItem) {
  const message = props.messages[item.slug] ?? null;
  const category = props.categories.find((entry) => entry.id === item.category) ?? null;
  const authorLabel = item.author ? `by ${item.author}` : "Registry skill";
  const updatedLabel = item.updatedAt
    ? `Updated ${formatRelativeTimestamp(item.updatedAt)}`
    : "Updated recently";
  return html`
    <article
      class="card"
      style="padding: 18px; border-radius: 20px; display: flex; flex-direction: column; gap: 12px; min-height: 280px;"
    >
      <div class="row" style="justify-content: space-between; align-items: center; gap: 16px; flex-wrap: nowrap;">
        <div style="min-width: 0; flex: 1;">
          ${
            category
              ? html`
                  <div
                    class="muted"
                    style=${`display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: ${
                      category.bgColor ?? "rgba(37, 99, 235, 0.08)"
                    }; color: ${category.textColor ?? "#1d4ed8"}; margin-bottom: 10px;`}
                  >
                    ${category.icon ? `${category.icon} ` : ""}${category.name}
                  </div>
                `
              : nothing
          }
        </div>
        ${renderInstallToggle(props, item)}
      </div>

      <div
        class="card-title"
        title=${item.displayName}
        style="font-size: 18px; line-height: 1.18; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 42px;"
      >
        ${item.displayName}
      </div>

      ${renderMetaRow(item)}

      <div
        class="card-sub"
        title=${item.summary}
        style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.55; min-height: calc(1.55em * 3); max-height: calc(1.55em * 3);"
      >
        ${item.summary}
      </div>

      ${
        item.tags.length > 0
          ? html`
              <div class="row" style="gap: 8px; flex-wrap: wrap;">
                ${item.tags.slice(0, 4).map(
                  (tag) => html`
                    <span
                      class="pill pill--sm"
                      title=${tag}
                      style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                    >
                      ${tag}
                    </span>
                  `,
                )}
              </div>
            `
          : nothing
      }

      <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px;">
        <div class="muted" style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <span
            title=${authorLabel}
            style="min-width: 0; flex: 1 1 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >
            ${authorLabel}
          </span>
          <span title=${updatedLabel} style="white-space: nowrap;">${updatedLabel}</span>
        </div>
        ${
          message
            ? html`
                <div
                  title=${message.message}
                  class="muted"
                  style=${`display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: ${
                    message.kind === "error"
                      ? "var(--danger-color, #d14343)"
                      : "var(--success-color, #0a7f5a)"
                  };`}
                >
                  ${message.message}
                </div>
              `
            : nothing
        }
      </div>
    </article>
  `;
}

export function renderSkillsMarket(props: SkillsMarketProps) {
  const selectedCategory =
    props.categories.find((entry) => entry.id === props.selectedCategory) ?? null;
  return html`
    <section class="card" style="padding: 24px;">
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <div
          style="display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; flex-wrap: wrap;"
        >
          <div style="max-width: 760px;">
            <div class="card-title" style="font-size: 28px; line-height: 1.1;">探索技能</div>
          </div>
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <label
              class="btn"
              style=${`cursor: ${props.archiveBusy || !props.connected ? "not-allowed" : "pointer"}; opacity: ${
                props.archiveBusy || !props.connected ? 0.7 : 1
              };`}
            >
              ${props.archiveBusy ? "导入中…" : "导入技能包"}
              <input
                type="file"
                accept=".zip,application/zip"
                style="display: none;"
                ?disabled=${props.archiveBusy || !props.connected}
                @change=${(event: Event) => {
                  const input = event.target as HTMLInputElement;
                  const file = input.files?.[0] ?? null;
                  if (file) {
                    props.onImportArchive(file);
                  }
                  input.value = "";
                }}
              />
            </label>
            ${
              props.registryBaseUrl
                ? html`
                    <a
                      class="btn"
                      href=${props.registryBaseUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开技能中心
                    </a>
                  `
                : nothing
            }
            <button class="btn" ?disabled=${props.loading || !props.connected} @click=${props.onRefresh}>
              ${props.loading ? "加载中…" : "刷新"}
            </button>
          </div>
        </div>

        <div class="row" style="gap: 10px; flex-wrap: wrap;">
          ${props.categories.map((category) =>
            renderCategoryChip(
              category,
              category.id === props.selectedCategory,
              props.onCategoryChange,
            ),
          )}
        </div>

        ${
          selectedCategory
            ? html`
                <div class="row" style="gap: 8px; align-items: center; flex-wrap: wrap;">
                  <span class="muted">分类：</span>
                  <button class="btn primary" style="border-radius: 999px;" @click=${() => props.onCategoryChange(null)}>
                    ${selectedCategory.name} ×
                  </button>
                </div>
              `
            : nothing
        }

        <div
          class="filters"
          style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px;"
        >
          <label class="field" style="flex: 1; min-width: 240px;">
            <input
              .value=${props.filter}
              @input=${(event: Event) => props.onSearchChange((event.target as HTMLInputElement).value)}
              placeholder="搜索技能"
              autocomplete="off"
              name="skills-market-filter"
            />
          </label>
          <label class="field" style="min-width: 180px;">
            <select
              .value=${props.sortBy}
              @change=${(event: Event) =>
                props.onSortChange(
                  (event.target as HTMLSelectElement).value as SkillsRegistrySortBy,
                )}
            >
              <option value="comprehensive">排序：综合</option>
              <option value="downloads">排序：下载量</option>
              <option value="updated">排序：最近更新</option>
            </select>
          </label>
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            ${renderInstallFilterButton({
              value: "all",
              active: props.installFilter === "all",
              label: "全部",
              onSelect: props.onInstallFilterChange,
            })}
            ${renderInstallFilterButton({
              value: "installed",
              active: props.installFilter === "installed",
              label: "已安装",
              onSelect: props.onInstallFilterChange,
            })}
            ${renderInstallFilterButton({
              value: "not_installed",
              active: props.installFilter === "not_installed",
              label: "未安装",
              onSelect: props.onInstallFilterChange,
            })}
          </div>
        </div>

        ${
          props.notice
            ? renderDismissibleCallout({
                tone: props.notice.kind === "error" ? "danger" : "success",
                message: props.notice.message,
                onClose: props.onDismissNotice,
              })
            : nothing
        }

        ${
          props.error
            ? renderDismissibleCallout({
                tone: "danger",
                message: props.error,
                onClose: props.onDismissError,
              })
            : nothing
        }

        ${
          props.items.length === 0
            ? html`
                <div class="muted" style="padding: 36px 0; text-align: center;">
                  ${
                    !props.connected
                      ? "未连接到网关。"
                      : props.loading
                        ? "正在加载技能…"
                        : "当前筛选条件下没有匹配的技能。"
                  }
                </div>
              `
            : html`
                <div
                  style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 364px), 1fr)); gap: 18px;"
                >
                  ${props.items.map((item) => renderCard(props, item))}
                </div>
                ${renderPagination(props)}
              `
        }
      </div>
    </section>
  `;
}
