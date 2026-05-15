import { Navigate, Route, Routes } from "react-router-dom";

import { PowerShellLayout } from "../layout/PowerShellLayout";
import { ChatPage } from "../pages/ChatPage";
import { SettingsConnectorsPage } from "../pages/settings/SettingsConnectorsPage";
import { SettingsConnectionPage } from "../pages/settings/SettingsConnectionPage";
import { SettingsLayout } from "../pages/settings/SettingsLayout";
import { SettingsMcpPage } from "../pages/settings/SettingsMcpPage";
import { SettingsModelsPage } from "../pages/settings/SettingsModelsPage";
import { SkillsPage } from "../pages/SkillsPage";
import { WorkbenchPage } from "../pages/WorkbenchPage";

/**
 * Hash-based routes so navigation works when the app is served from `react.html` (any pathname).
 */
export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<PowerShellLayout />}>
        <Route index element={<ChatPage />} />
        <Route path="workbench" element={<WorkbenchPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="connection" replace />} />
          <Route path="connection" element={<SettingsConnectionPage />} />
          <Route path="models" element={<SettingsModelsPage />} />
          <Route path="connectors" element={<SettingsConnectorsPage />} />
          <Route path="mcp" element={<SettingsMcpPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
