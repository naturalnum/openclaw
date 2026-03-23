/**
 * skills-hub controller
 *
 * 独立于 skills controller，拥有自己的状态字段（hub 前缀）。
 * 调用独立的后端 RPC 命名空间（skillsHub.*），不与 skills 菜单共享
 * 任何状态或方法，方便后续扩展 hub 专属功能（批量操作、收藏、
 * 自定义排序等）而不影响 skills 面板。
 *
 * 数据来源说明：
 *   - 已安装技能：来自本地 skills/ 目录，通过 skillsHub.catalog 返回，
 *                installed=true
 *   - 未安装技能：来自远端仓库（当前为 stub），通过 skillsHub.catalog
 *                返回，installed=false
 */

import type { GatewayBrowserClient } from "../gateway.ts";
import type { SkillHubCatalog, SkillHubItem, SkillStatusReport } from "../types.ts";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type HubSkillMessage = {
  kind: "success" | "error";
  message: string;
};

export type HubSkillMessageMap = Record<string, HubSkillMessage>;

export type SkillsHubState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  // 个别 agent 状态报告（兼容旧逻辑）
  hubSkillsLoading: boolean;
  hubSkillsReport: SkillStatusReport | null;
  hubSkillsError: string | null;
  hubSkillsBusyKey: string | null;
  hubSkillEdits: Record<string, string>;
  hubSkillMessages: HubSkillMessageMap;
  // 合并目录：已安装(本地) + 可安装(仓库)
  hubCatalogLoading: boolean;
  hubCatalog: SkillHubCatalog | null;
  hubCatalogError: string | null;
  // 分页
  hubCatalogPage: number;
  hubCatalogPageSize: number;
  hubCatalogKeyword: string;
  // 视图模式和数据源
  hubViewMode: "card" | "table";
  hubDataSource: "installed" | "repo";
  // 卸载确认弹窗
  hubUninstallConfirmKey: string | null;
};

type LoadSkillsHubOptions = {
  clearMessages?: boolean;
};

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

function setHubSkillMessage(state: SkillsHubState, key: string, message?: HubSkillMessage) {
  if (!key.trim()) {
    return;
  }
  const next = { ...state.hubSkillMessages };
  if (message) {
    next[key] = message;
  } else {
    delete next[key];
  }
  state.hubSkillMessages = next;
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 从网关拉取已安装技能状态，写入 hub 专属状态。
 * 保留旧接口完整性，面板内部仍可以使用。
 */
export async function loadSkillsHub(state: SkillsHubState, options?: LoadSkillsHubOptions) {
  if (options?.clearMessages && Object.keys(state.hubSkillMessages).length > 0) {
    state.hubSkillMessages = {};
  }
  if (!state.client || !state.connected) {
    return;
  }
  if (state.hubSkillsLoading) {
    return;
  }
  state.hubSkillsLoading = true;
  state.hubSkillsError = null;
  try {
    const res = await state.client.request<SkillStatusReport | undefined>("skillsHub.status", {});
    if (res) {
      state.hubSkillsReport = res;
    }
  } catch (err) {
    state.hubSkillsError = getErrorMessage(err);
  } finally {
    state.hubSkillsLoading = false;
  }
}

/**
 * 从网关拉取已安装 + 仓库可安装技能合并目录。
 * 这是 skills-hub 面板的主要数据源：
 *   - 已安装：来自本地 skills/ 目录，installed=true
 *   - 未安装：来自远端仓库（当前 stub，返回空列表），installed=false
 */
export async function fetchHubCatalog(state: SkillsHubState, options?: LoadSkillsHubOptions) {
  if (options?.clearMessages && Object.keys(state.hubSkillMessages).length > 0) {
    state.hubSkillMessages = {};
  }
  if (!state.client || !state.connected) {
    return;
  }
  if (state.hubCatalogLoading) {
    return;
  }
  state.hubCatalogLoading = true;
  state.hubCatalogError = null;
  try {
    const res = await state.client.request<SkillHubCatalog | undefined>("skillsHub.catalog", {
      page: state.hubCatalogPage,
      pageSize: state.hubCatalogPageSize || 20,
      keyword: state.hubCatalogKeyword || undefined,
    });
    if (res) {
      state.hubCatalog = res;
    }
  } catch (err) {
    state.hubCatalogError = getErrorMessage(err);
  } finally {
    state.hubCatalogLoading = false;
  }
}

/** 更新 API Key 编辑暂存值 */
export function updateHubSkillEdit(state: SkillsHubState, skillKey: string, value: string) {
  state.hubSkillEdits = { ...state.hubSkillEdits, [skillKey]: value };
}

/** 启用/禁用技能 */
export async function updateHubSkillEnabled(
  state: SkillsHubState,
  skillKey: string,
  enabled: boolean,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.hubSkillsBusyKey = skillKey;
  state.hubSkillsError = null;
  try {
    await state.client.request("skillsHub.update", { skillKey, enabled });
    // 同时刷新 catalog 和旧版数据
    await Promise.all([fetchHubCatalog(state), loadSkillsHub(state)]);
    setHubSkillMessage(state, skillKey, {
      kind: "success",
      message: enabled ? "已启用" : "已禁用",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.hubSkillsError = message;
    setHubSkillMessage(state, skillKey, { kind: "error", message });
  } finally {
    state.hubSkillsBusyKey = null;
  }
}

/** 保存 API Key */
export async function saveHubSkillApiKey(state: SkillsHubState, skillKey: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.hubSkillsBusyKey = skillKey;
  state.hubSkillsError = null;
  try {
    const apiKey = state.hubSkillEdits[skillKey] ?? "";
    await state.client.request("skillsHub.update", { skillKey, apiKey });
    await Promise.all([fetchHubCatalog(state), loadSkillsHub(state)]);
    setHubSkillMessage(state, skillKey, {
      kind: "success",
      message: "API 密钥已保存",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.hubSkillsError = message;
    setHubSkillMessage(state, skillKey, { kind: "error", message });
  } finally {
    state.hubSkillsBusyKey = null;
  }
}

/** 安装技能 */
export async function installHubSkill(
  state: SkillsHubState,
  skillKey: string,
  name: string,
  installId: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.hubSkillsBusyKey = skillKey;
  state.hubSkillsError = null;
  try {
    const result = await state.client.request<{ message?: string }>("skillsHub.install", {
      name,
      installId,
      timeoutMs: 120000,
    });
    // 安装完成后刷新 catalog（已安装列表会增加）
    await fetchHubCatalog(state);
    setHubSkillMessage(state, skillKey, {
      kind: "success",
      message: result?.message ?? "安装成功",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.hubSkillsError = message;
    setHubSkillMessage(state, skillKey, { kind: "error", message });
  } finally {
    state.hubSkillsBusyKey = null;
  }
}

/** 从远端仓库下载并安装技能 */
export async function installHubSkillFromRepo(
  state: SkillsHubState,
  slug: string,
  downloadUrl: string,
  version?: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.hubSkillsBusyKey = slug;
  state.hubSkillsError = null;
  try {
    const result = await state.client.request<{ message?: string }>("skillsHub.installFromRepo", {
      slug,
      downloadUrl,
      version: version ?? "",
      timeoutMs: 120000,
    });
    // Refresh both installed list and repo catalog, then switch to the installed tab.
    await Promise.all([loadSkillsHub(state), fetchHubCatalog(state)]);
    state.hubDataSource = "installed";
    setHubSkillMessage(state, slug, {
      kind: "success",
      message: result?.message ?? "安装成功",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.hubSkillsError = message;
    setHubSkillMessage(state, slug, { kind: "error", message });
  } finally {
    state.hubSkillsBusyKey = null;
  }
}

/**
 * 从 catalog 获取所有技能列表（包含已安装和未安装）。
 * 当 catalog 数据不可用时回退到 hubSkillsReport。
 */
export function getHubAllSkills(state: SkillsHubState): SkillHubItem[] {
  if (state.hubCatalog) {
    return state.hubCatalog.all;
  }
  // 将旧版数据适配为 SkillHubItem
  return (state.hubSkillsReport?.skills ?? []).map((s) => ({ ...s, installed: true }));
}

/** 切换分页并重新加载 catalog */
export async function setHubCatalogPage(state: SkillsHubState, page: number) {
  state.hubCatalogPage = page;
  await fetchHubCatalog(state);
}

/** 切换每页数量并重置到第 1 页 */
export async function setHubCatalogPageSize(state: SkillsHubState, pageSize: number) {
  state.hubCatalogPageSize = pageSize;
  state.hubCatalogPage = 1;
  await fetchHubCatalog(state);
}

/**
 * 触发浏览器下载技能压缩包（.tar.gz）
 * 通过网关代理 HTTP 端点 /api/skills-hub/download?slug=xxx 获取文件流
 */
export function downloadHubSkill(
  _state: SkillsHubState,
  slug: string,
  gatewayUrl: string,
  gatewayToken: string,
  downloadUrl?: string,
) {
  // The gatewayUrl may be a WebSocket URL (ws:// / wss://) – convert to HTTP(S)
  // so the browser can use it as a normal anchor download href.
  const base = gatewayUrl
    .replace(/^ws:\/\//, "http://")
    .replace(/^wss:\/\//, "https://")
    .replace(/\/+$/, "");
  const token = gatewayToken.trim();
  if (!base || !slug) {
    return;
  }

  // Build the download URL; attach token as query param for simple anchor-click downloads
  // (Bearer header not settable via <a href>)
  // Also pass downloadUrl as query param so the gateway can skip the catalog lookup.
  const dlParam = downloadUrl?.trim()
    ? `&downloadUrl=${encodeURIComponent(downloadUrl.trim())}`
    : "";
  const url = `${base}/api/skills-hub/download?slug=${encodeURIComponent(slug)}${token ? `&token=${encodeURIComponent(token)}` : ""}${dlParam}`;
  // Infer file extension from downloadUrl for the save-as dialog
  const dlLower = (downloadUrl?.trim() ?? "").split("?")[0]?.toLowerCase() ?? "";
  const ext = dlLower.endsWith(".zip")
    ? ".zip"
    : dlLower.endsWith(".tar.bz2")
      ? ".tar.bz2"
      : ".tar.gz";
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slug}${ext}`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/** 卸载已安装技能（仅 managed skills） */
export async function uninstallHubSkill(state: SkillsHubState, skillKey: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.hubSkillsBusyKey = skillKey;
  state.hubUninstallConfirmKey = null;
  state.hubSkillsError = null;
  try {
    await state.client.request("skillsHub.uninstall", { skillKey });
    await Promise.all([fetchHubCatalog(state), loadSkillsHub(state)]);
    setHubSkillMessage(state, skillKey, { kind: "success", message: "已卸载" });
  } catch (err) {
    const message = getErrorMessage(err);
    state.hubSkillsError = message;
    setHubSkillMessage(state, skillKey, { kind: "error", message });
  } finally {
    state.hubSkillsBusyKey = null;
  }
}
