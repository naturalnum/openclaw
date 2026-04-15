import type {
  ConnectorActionDefinition,
  ConnectorActionPolicy,
  ConnectorInstancePolicy,
} from "./types.js";

const WRITE_MODE_ALLOWLIST = new Set<ConnectorInstancePolicy["mode"]>(["limited-write", "full"]);

export function resolveConnectorActionPolicy(params: {
  policy: ConnectorInstancePolicy;
  action: ConnectorActionDefinition;
}): ConnectorActionPolicy {
  const { policy, action } = params;
  if (policy.deniedActions.includes(action.name)) {
    return "deny";
  }
  if (policy.requireApprovalActions.includes(action.name)) {
    return "approval";
  }
  if (policy.allowedActions.includes(action.name)) {
    return "allow";
  }
  if (action.access === "write" && !WRITE_MODE_ALLOWLIST.has(policy.mode)) {
    return "deny";
  }
  if (policy.mode === "limited-write" && action.riskLevel === "critical") {
    return "approval";
  }
  return action.defaultPolicy;
}
