import { html, nothing } from "lit";
import type { HubSkillMessageMap } from "../controllers/skills-hub.ts";
import { clampText } from "../format.ts";
import type { SkillHubItem } from "../types.ts";
import {
  computeSkillMissing,
  computeSkillReasons,
  renderSkillStatusChips,
} from "./skills-shared.ts";

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
  onFilterChange: (next: string) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onRequestUpdate?: () => void;
};

// ─── Tab 定义（全部 / 已安装 / 未安装）────────────────────────────────────────

type HubTab = "all" | "installed" | "not-installed";

const HUB_TABS: Array<{ id: HubTab; label: string }> = [
  { id: "all", label: "全部" },
  { id: "installed", label: "已安装" },
  { id: "not-installed", label: "未安装" },
];

// 模块级状态（切换其他 Tab 再回来时保留）
let _hubTab: HubTab = "all";

// 轻量重渲染触发
function requestUpdate(props: SkillsHubProps) {
  props.onRequestUpdate?.();
  if (!props.onRequestUpdate) {
    props.onFilterChange(props.filter);
  }
}

// ─── 技能分类逻辑 ──────────────────────────────────────────────────────────────

/**
 * 已安装判定：直接使用后端返回的 installed 字段。
 * 已安装技能来自本地 skills/ 目录；未安装技能来自仓库。
 */
function filterByTab(skills: SkillHubItem[], tab: HubTab): SkillHubItem[] {
  switch (tab) {
    case "installed":
      return skills.filter((s) => s.installed);
    case "not-installed":
      return skills.filter((s) => !s.installed);
    default:
      return skills;
  }
}

// ─── 主渲染 ───────────────────────────────────────────────────────────────────

export function renderSkillsHub(props: SkillsHubProps) {
  const skills = props.allSkills;

  // 搜索过滤
  const filter = props.filter.trim().toLowerCase();
  const searched = filter
    ? skills.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : skills;

  // Tab 过滤
  const tabFiltered = filterByTab(searched, _hubTab);

  // Tab 数量统计（基于搜索后的结果）
  const counts: Record<HubTab, number> = {
    all: searched.length,
    installed: filterByTab(searched, "installed").length,
    "not-installed": filterByTab(searched, "not-installed").length,
  };

  // Stats（基于全量）
  const totalSkills = skills.length;
  const installedCount = skills.filter((s) => s.installed).length;
  const availableCount = skills.filter((s) => !s.installed).length;
  const enabledSkills = skills.filter((s) => s.installed && !s.disabled).length;

  return html`
    <div class="skills-hub">

      <!-- Header -->
      <section class="card" style="margin-bottom: 16px;">
        <div class="row" style="justify-content: space-between; align-items: flex-start;">
          <div>
            <div class="card-title">技能仓库</div>
            <div class="card-sub">浏览、管理和安装技能。</div>
          </div>
          <button
            class="btn"
            ?disabled=${props.loading || !props.connected}
            @click=${props.onRefresh}
          >
            ${props.loading ? "加载中…" : "刷新"}
          </button>
        </div>

        <!-- Stats row -->
        ${
          totalSkills > 0
            ? html`
                <div class="row" style="gap: 16px; margin-top: 16px; flex-wrap: wrap;">
                  ${renderStatBadge("总计", totalSkills, "#6366f1")}
                  ${renderStatBadge("已安装", installedCount, "#0a7f5a")}
                  ${renderStatBadge("可安装", availableCount, "#0369a1")}
                  ${renderStatBadge("已启用", enabledSkills, "#d97706")}
                </div>
              `
            : nothing
        }

        <!-- Search filter -->
        <div
          class="filters"
          style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 16px;"
        >
          <label class="field" style="flex: 1; min-width: 200px;">
            <input
              .value=${props.filter}
              @input=${(e: Event) => props.onFilterChange((e.target as HTMLInputElement).value)}
              placeholder="按名称、描述或来源搜索…"
              autocomplete="off"
              name="skills-hub-filter"
            />
          </label>
          <div class="muted">${searched.length} / ${totalSkills} 个技能</div>
        </div>

        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
      </section>

      <!-- Content -->
      ${
        !props.connected && skills.length === 0
          ? html`
              <section class="card">
                <div class="muted">未连接到网关，请先连接以加载技能。</div>
              </section>
            `
          : html`
              <section class="card">
                <!-- Tab 页签 -->
                <div
                  class="row"
                  style="gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border-color, #e5e7eb); padding-bottom: 0;"
                >
                  ${HUB_TABS.map(
                    (tab) => html`
                      <button
                        class="btn btn--sm"
                        style="
                          border-radius: 6px 6px 0 0;
                          border-bottom: 2px solid ${_hubTab === tab.id ? "var(--primary-color, #6366f1)" : "transparent"};
                          color: ${_hubTab === tab.id ? "var(--primary-color, #6366f1)" : "inherit"};
                          font-weight: ${_hubTab === tab.id ? "600" : "400"};
                          padding: 6px 14px;
                          margin-bottom: -1px;
                        "
                        @click=${() => {
                          _hubTab = tab.id;
                          requestUpdate(props);
                        }}
                      >
                        ${tab.label}
                        <span
                          class="muted"
                          style="
                            background: var(--muted-bg, #f3f4f6);
                            border-radius: 999px;
                            padding: 0 7px;
                            font-size: 11px;
                            margin-left: 4px;
                            font-weight: 400;
                          "
                        >${counts[tab.id]}</span>
                      </button>
                    `,
                  )}
                </div>

                <!-- 技能卡片网格 -->
                ${
                  searched.length === 0 && filter
                    ? html`<div class="muted" style="font-size: 13px;">未找到符合条件的技能。</div>`
                    : tabFiltered.length === 0
                      ? html`<div class="muted" style="font-size: 13px;">${_hubTab === "not-installed" ? "暂无可安装的新技能。" : "暂无此类技能。"}</div>`
                      : html`
                          <div
                            class="skills-hub__grid"
                            style="
                              display: grid;
                              grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                              gap: 12px;
                            "
                          >
                            ${tabFiltered.map((skill) => renderSkillCard(skill, props))}
                          </div>
                        `
                }
              </section>
            `
      }
    </div>
  `;
}

// ─── 辅助渲染 ─────────────────────────────────────────────────────────────────

function renderStatBadge(label: string, count: number, color: string) {
  return html`
    <div
      style="
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 18px;
        border-radius: 8px;
        background: var(--card-bg, #f9fafb);
        border: 1px solid var(--border-color, #e5e7eb);
        min-width: 80px;
      "
    >
      <span style="font-size: 22px; font-weight: 700; color: ${color}; line-height: 1.2;">${count}</span>
      <span class="muted" style="font-size: 11px; margin-top: 2px;">${label}</span>
    </div>
  `;
}

function renderSkillCard(skill: SkillHubItem, props: SkillsHubProps) {
  const busy = props.busyKey === skill.skillKey;
  const apiKey = props.edits[skill.skillKey] ?? "";
  const message = props.messages[skill.skillKey] ?? null;
  // 未安装技能：有 install 入口且依赖缺失
  const canInstall = !skill.installed
    ? skill.install.length > 0
    : skill.install.length > 0 && skill.missing.bins.length > 0;
  const showBundledBadge = Boolean(skill.bundled && skill.source !== "openclaw-bundled");
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
  const isReady = skill.installed && !skill.disabled && missing.length === 0;

  return html`
    <div
      class="skills-hub__card"
      style="
        border: 1px solid ${skill.installed ? "var(--border-color, #e5e7eb)" : "var(--primary-color-muted, #c7d2fe)"};
        border-radius: 10px;
        padding: 14px;
        background: var(--card-bg, #fff);
        display: flex;
        flex-direction: column;
        gap: 8px;
        opacity: ${skill.installed && skill.disabled ? "0.65" : "1"};
        transition: opacity 0.15s;
      "
    >
      <!-- 标题行 -->
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 6px;">
        <div style="flex: 1; min-width: 0;">
          <div
            class="list-title"
            style="font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
          >
            ${skill.emoji ? `${skill.emoji} ` : ""}${skill.name}
          </div>
        </div>
        <!-- 状态指示点 -->
        <span
          title="${!skill.installed ? "未安装" : isReady ? "可用" : skill.disabled ? "已禁用" : "存在问题"}"
          style="
            display: inline-block;
            width: 8px; height: 8px;
            border-radius: 50%;
            background: ${
              !skill.installed
                ? "var(--muted-color, #9ca3af)"
                : isReady
                  ? "var(--success-color, #0a7f5a)"
                  : skill.disabled
                    ? "var(--muted-color, #9ca3af)"
                    : "var(--danger-color, #d14343)"
            };
            flex-shrink: 0;
            margin-top: 4px;
          "
        ></span>
      </div>

      <!-- 安装状态标签 -->
      ${
        !skill.installed
          ? html`
              <span
                style="
                  display: inline-block;
                  font-size: 10px;
                  padding: 2px 8px;
                  border-radius: 999px;
                  background: var(--primary-color-muted, #e0e7ff);
                  color: var(--primary-color, #6366f1);
                  font-weight: 600;
                  width: fit-content;
                "
              >可安装</span>
            `
          : nothing
      }

      <!-- 描述 -->
      <div class="list-sub" style="font-size: 12px; line-height: 1.5; flex: 1;">
        ${clampText(skill.description, 100)}
      </div>

      ${skill.installed ? renderSkillStatusChips({ skill, showBundledBadge }) : nothing}

      ${skill.installed && missing.length > 0 ? html`<div class="muted" style="font-size: 11px;">缺少依赖：${missing.join(", ")}</div>` : nothing}
      ${skill.installed && reasons.length > 0 ? html`<div class="muted" style="font-size: 11px;">原因：${reasons.join(", ")}</div>` : nothing}

      <!-- 操作按钮 -->
      <div class="row" style="gap: 6px; flex-wrap: wrap; margin-top: 4px;">
        ${
          skill.installed
            ? html`
                <button
                  class="btn btn--sm"
                  style="flex: 1;"
                  ?disabled=${busy}
                  @click=${() => props.onToggle(skill.skillKey, skill.disabled)}
                >
                  ${skill.disabled ? "启用" : "禁用"}
                </button>
              `
            : nothing
        }
        ${
          canInstall
            ? html`
                <button
                  class="btn btn--sm${skill.installed ? "" : " primary"}"
                  style="flex: 1;"
                  ?disabled=${busy}
                  @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
                >
                  ${busy ? "安装中…" : skill.install[0].label}
                </button>
              `
            : nothing
        }
      </div>

      <!-- 操作反馈 -->
      ${
        message
          ? html`
              <div
                class="muted"
                style="font-size: 11px; color: ${message.kind === "error" ? "var(--danger-color, #d14343)" : "var(--success-color, #0a7f5a)"};"
              >${message.message}</div>
            `
          : nothing
      }

      <!-- API 密钥输入（仅已安装技能） -->
      ${
        skill.installed && skill.primaryEnv
          ? html`
              <div class="field" style="margin-top: 4px;">
                <span style="font-size: 11px;">API 密钥</span>
                <input
                  type="password"
                  .value=${apiKey}
                  @input=${(e: Event) => props.onEdit(skill.skillKey, (e.target as HTMLInputElement).value)}
                  style="font-size: 12px;"
                />
              </div>
              <button
                class="btn btn--sm primary"
                ?disabled=${busy}
                @click=${() => props.onSaveKey(skill.skillKey)}
              >
                保存密钥
              </button>
            `
          : nothing
      }
    </div>
  `;
}
