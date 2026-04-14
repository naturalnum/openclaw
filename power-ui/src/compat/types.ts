export type {
  AgentFileEntry,
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ConfigSnapshot,
  CronJob,
  LogEntry,
  LogLevel,
  ModelCatalogEntry,
  SessionsUsageResult,
  SessionsListResult,
  SkillStatusEntry,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../../../ui/src/ui/types.ts";

export type {
  SkillsRegistryCategory,
  SkillsRegistryCatalogItem,
  SkillsRegistryInstallArchiveResult,
  SkillsRegistryInstallResult,
  SkillsRegistryListResult,
  SkillsRegistryPagination,
  SkillsRegistryUninstallResult,
} from "../../../src/gateway/protocol/schema/types.ts";

export type SkillsRegistryInstallFilter = "all" | "installed" | "not_installed";
export type SkillsRegistrySortBy = "comprehensive" | "downloads" | "updated";
