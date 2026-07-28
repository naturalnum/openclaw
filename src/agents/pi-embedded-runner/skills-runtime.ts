import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { loadWorkspaceSkillEntries, type SkillEntry, type SkillSnapshot } from "../skills.js";
import { resolveSkillRuntimeConfig } from "../skills/runtime-config.js";

export function resolveEmbeddedRunSkillEntries(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  agentId?: string;
  skillsSnapshot?: SkillSnapshot;
}): {
  shouldLoadSkillEntries: boolean;
  skillEntries: SkillEntry[];
  skillReadOnlyRoots: string[];
} {
  const shouldLoadSkillEntries = !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
  const config = resolveSkillRuntimeConfig(params.config);
  const skillEntries = shouldLoadSkillEntries
    ? loadWorkspaceSkillEntries(params.workspaceDir, { config, agentId: params.agentId })
    : [];
  const resolvedSkills =
    params.skillsSnapshot?.resolvedSkills ?? skillEntries.map((entry) => entry.skill);
  return {
    shouldLoadSkillEntries,
    skillEntries,
    skillReadOnlyRoots: Array.from(
      new Set(resolvedSkills.map((skill) => skill.baseDir.trim()).filter(Boolean)),
    ),
  };
}
