/**
 * In-app paths for HashRouter (e.g. `react.html#/`, `react.html#/skills`).
 */
export const ROUTES = {
  /** React 对话首页 */
  root: "/",
  workbench: "/workbench",
  skills: "/skills",
  /** 设置区入口（重定向到 connection） */
  settings: "/settings",
  settingsConnection: "/settings/connection",
  settingsModels: "/settings/models",
  settingsConnectors: "/settings/connectors",
  settingsMcp: "/settings/mcp",
} as const;

export type PowerUiPath = (typeof ROUTES)[keyof typeof ROUTES];
