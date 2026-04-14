import { loadCronJobsPage as upstreamLoadCronJobsPage } from "../../../ui/src/ui/controllers/cron.ts";

export { loadChannels } from "../../../ui/src/ui/controllers/channels.ts";
export type { ChannelsState } from "../../../ui/src/ui/controllers/channels.types.ts";
export {
  abortChatRun,
  handleChatEvent,
  sendChatMessage,
} from "../../../ui/src/ui/controllers/chat.ts";
export type { ChatState } from "../../../ui/src/ui/controllers/chat.ts";
export {
  cloneConfigObject,
  serializeConfigForm,
} from "../../../ui/src/ui/controllers/config/form-utils.ts";
export {
  backfillDreamDiary,
  copyDreamingArchivePath,
  dedupeDreamDiary,
  loadDreamDiary,
  loadDreamingStatus,
  loadWikiImportInsights,
  loadWikiMemoryPalace,
  repairDreamingArtifacts,
  resetGroundedShortTerm,
  resetDreamDiary,
  resolveConfiguredDreaming,
  updateDreamingEnabled,
} from "../../../ui/src/ui/controllers/dreaming.ts";
export type {
  DreamingState,
  DreamingStatus,
  WikiImportInsights,
  WikiMemoryPalace,
} from "../../../ui/src/ui/controllers/dreaming.ts";
export {
  addCronJob,
  cancelCronEdit,
  getVisibleCronJobs,
  hasCronFormErrors,
  loadCronJobsPage,
  loadCronModelSuggestions,
  loadCronRuns,
  loadCronStatus,
  loadMoreCronRuns,
  normalizeCronFormState,
  removeCronJob,
  runCronJob,
  startCronClone,
  startCronEdit,
  toggleCronJob,
  updateCronJobsFilter,
  updateCronRunsFilter,
  validateCronForm,
} from "../../../ui/src/ui/controllers/cron.ts";
export type { CronModelSuggestionsState, CronState } from "../../../ui/src/ui/controllers/cron.ts";
export {
  DEFAULT_SKILLS_INSTALL_FILTER,
  DEFAULT_SKILLS_REGISTRY_PAGINATION,
  DEFAULT_SKILLS_SORT_BY,
  importRegistrySkillArchive,
  loadSkillsMarket as loadSkills,
  setSkillsCategory,
  setSkillsFilter,
  setSkillsInstallFilter,
  setSkillsPage,
  setSkillsSortBy,
  toggleRegistrySkillInstall,
} from "./skills-market-controller.ts";
export type {
  SkillMessage,
  SkillMessageMap,
  SkillsMarketState as SkillsState,
} from "./skills-market-controller.ts";
export { loadLogs } from "../../../ui/src/ui/controllers/logs.ts";
export type { LogsState } from "../../../ui/src/ui/controllers/logs.ts";

export async function loadCronJobs(
  state: import("../../../ui/src/ui/controllers/cron.ts").CronState,
) {
  return await upstreamLoadCronJobsPage(state);
}

export async function reloadCronJobs(
  state: import("../../../ui/src/ui/controllers/cron.ts").CronState,
) {
  return await upstreamLoadCronJobsPage(state);
}

export async function loadMoreCronJobs(
  state: import("../../../ui/src/ui/controllers/cron.ts").CronState,
) {
  return await upstreamLoadCronJobsPage(state, { append: true });
}
