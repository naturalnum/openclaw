import { createHash, randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import type { SecretInput } from "../config/types.secrets.js";
import { resolveConfiguredSecretInputString } from "../gateway/resolve-configured-secret-input-string.js";
import type { GatewayClient, GatewayRequestContext } from "../gateway/server-methods/types.js";
import type { PluginApprovalRequestPayload } from "../infra/plugin-approvals.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { appendConnectorAudit } from "./audit.js";
import { resolveConnectorActionPolicy } from "./policy.js";
import { getConnectorProvider, listConnectorProviders } from "./providers/index.js";
import {
  buildConnectorInstance,
  deleteConnectorInstance,
  getConnectorInstance,
  getConnectorInstanceSync,
  listConnectorInstances,
  listConnectorInstancesSync,
  writeConnectorInstance,
} from "./storage.js";
import type {
  ConnectorCapability,
  ConnectorInstance,
  ConnectorPolicyMode,
  ConnectorToolSummary,
} from "./types.js";

function resolveOwnerAccountId(client: GatewayClient | null): string {
  return client?.connect.client.instanceId?.trim() || "default";
}

function sanitizeConnectorToolToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function compactConnectorToolToken(value: string, maxLength: number): string {
  const sanitized = sanitizeConnectorToolToken(value);
  if (sanitized.length <= maxLength) {
    return sanitized;
  }
  return sanitized.slice(0, maxLength).replace(/^_+|_+$/g, "");
}

export function buildConnectorToolName(params: { instanceId: string; action: string }): string {
  const instanceBase = params.instanceId.replace(/^connector_/, "");
  const instancePart = compactConnectorToolToken(instanceBase, 12) || "instance";
  const actionPart = compactConnectorToolToken(params.action.replace(/\./g, "_"), 24) || "action";
  const digest = createHash("sha1")
    .update(`${params.instanceId}:${params.action}`)
    .digest("hex")
    .slice(0, 8);
  return `conn_${instancePart}_${actionPart}_${digest}`;
}

async function resolveSecretInputs(secretInputs: Record<string, SecretInput>) {
  const cfg = loadConfig();
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(secretInputs)) {
    const hit = await resolveConfiguredSecretInputString({
      config: cfg,
      env: process.env,
      value,
      path: `connectors.secretInputs.${key}`,
    });
    if (hit.value) {
      resolved[key] = hit.value;
    }
  }
  return resolved;
}

export async function listConnectorCatalog() {
  return listConnectorProviders().map((provider) => provider.definition);
}

export async function getConnectorCatalogEntry(providerId: string) {
  return getConnectorProvider(providerId)?.definition ?? null;
}

export async function listOwnedConnectorInstances(accountId: string) {
  const items = await listConnectorInstances();
  return items.filter((item) => item.ownerAccountId === accountId);
}

export function listOwnedConnectorInstancesSync(accountId: string) {
  const items = listConnectorInstancesSync();
  return items.filter((item) => item.ownerAccountId === accountId);
}

export async function createConnectorInstanceForClient(params: {
  client: GatewayClient | null;
  providerId: string;
  displayName: string;
  description?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  secretInputs?: Record<string, unknown>;
  policy?: {
    mode?: ConnectorPolicyMode;
    allowedActions?: string[];
    deniedActions?: string[];
    requireApprovalActions?: string[];
  };
}) {
  const provider = getConnectorProvider(params.providerId);
  if (!provider) {
    throw new Error(`unknown connector provider: ${params.providerId}`);
  }
  const instance = buildConnectorInstance({
    ownerAccountId: resolveOwnerAccountId(params.client),
    providerId: params.providerId,
    displayName: params.displayName,
    description: params.description,
    enabled: params.enabled,
    config: params.config,
    secretInputs: params.secretInputs,
    policy: params.policy,
  });
  const validation = await provider.validate({
    config: instance.config,
    secretInputs: instance.secretInputs,
  });
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }
  instance.status = instance.enabled ? "active" : "draft";
  await writeConnectorInstance(instance);
  return instance;
}

export async function updateConnectorInstanceForClient(params: {
  client: GatewayClient | null;
  id: string;
  displayName: string;
  description?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  secretInputs?: Record<string, unknown>;
  policy?: {
    mode?: ConnectorPolicyMode;
    allowedActions?: string[];
    deniedActions?: string[];
    requireApprovalActions?: string[];
  };
}) {
  const current = await getConnectorInstance(params.id);
  if (!current) {
    throw new Error(`connector instance not found: ${params.id}`);
  }
  if (current.ownerAccountId !== resolveOwnerAccountId(params.client)) {
    throw new Error("connector instance is not owned by the current account");
  }
  const provider = getConnectorProvider(current.providerId);
  if (!provider) {
    throw new Error(`unknown connector provider: ${current.providerId}`);
  }
  const next = buildConnectorInstance({
    id: current.id,
    ownerAccountId: current.ownerAccountId,
    providerId: current.providerId,
    connectorType: current.connectorType,
    displayName: params.displayName,
    description: params.description,
    enabled: params.enabled,
    status: current.status,
    config: params.config,
    secretInputs: params.secretInputs,
    policy: params.policy,
    createdAt: current.createdAt,
    health: current.health,
  });
  const validation = await provider.validate({
    config: next.config,
    secretInputs: next.secretInputs,
  });
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }
  next.status = next.enabled ? "active" : "draft";
  await writeConnectorInstance(next);
  return next;
}

export async function setConnectorInstanceEnabled(params: {
  client: GatewayClient | null;
  id: string;
  enabled: boolean;
}) {
  const current = await getConnectorInstance(params.id);
  if (!current) {
    throw new Error(`connector instance not found: ${params.id}`);
  }
  return await updateConnectorInstanceForClient({
    client: params.client,
    id: current.id,
    displayName: current.displayName,
    description: current.description,
    enabled: params.enabled,
    config: current.config,
    secretInputs: current.secretInputs,
    policy: current.policy,
  });
}

export async function removeConnectorInstanceForClient(params: {
  client: GatewayClient | null;
  id: string;
}) {
  const current = await getConnectorInstance(params.id);
  if (!current) {
    return false;
  }
  if (current.ownerAccountId !== resolveOwnerAccountId(params.client)) {
    throw new Error("connector instance is not owned by the current account");
  }
  return await deleteConnectorInstance(params.id);
}

export async function testConnectorInstanceForClient(params: {
  client: GatewayClient | null;
  id: string;
}) {
  const current = await getConnectorInstance(params.id);
  if (!current) {
    throw new Error(`connector instance not found: ${params.id}`);
  }
  if (current.ownerAccountId !== resolveOwnerAccountId(params.client)) {
    throw new Error("connector instance is not owned by the current account");
  }
  const provider = getConnectorProvider(current.providerId);
  if (!provider) {
    throw new Error(`unknown connector provider: ${current.providerId}`);
  }
  const secrets = await resolveSecretInputs(current.secretInputs);
  const result = await provider.testConnection({
    config: current.config,
    secrets,
  });
  current.health = {
    status: result.ok ? "healthy" : "error",
    lastCheckedAt: Date.now(),
    lastError: result.ok ? null : result.message,
  };
  current.status = result.ok ? (current.enabled ? "active" : "draft") : "error";
  current.updatedAt = Date.now();
  await writeConnectorInstance(current);
  return {
    ...result,
    instance: current,
  };
}

export async function listConnectorCapabilities(params: {
  client: GatewayClient | null;
}): Promise<ConnectorCapability[]> {
  const instances = await listOwnedConnectorInstances(resolveOwnerAccountId(params.client));
  return buildConnectorCapabilities(instances);
}

export function listConnectorCapabilitiesForAccountSync(params: {
  ownerAccountId: string;
}): ConnectorCapability[] {
  const instances = listOwnedConnectorInstancesSync(params.ownerAccountId);
  return buildConnectorCapabilities(instances);
}

function buildConnectorCapabilities(instances: ConnectorInstance[]): ConnectorCapability[] {
  return instances
    .filter((instance) => instance.enabled)
    .map((instance) => {
      const provider = getConnectorProvider(instance.providerId);
      if (!provider) {
        return null;
      }
      return {
        instanceId: instance.id,
        providerId: instance.providerId,
        displayName: instance.displayName,
        enabled: instance.enabled,
        actions: provider.definition.actions
          .map((action) => ({
            ...action,
            effectivePolicy: resolveConnectorActionPolicy({
              policy: instance.policy,
              action,
            }),
          }))
          .filter((action) => action.effectivePolicy !== "deny"),
      };
    })
    .filter((value): value is ConnectorCapability => value != null);
}

export async function listConnectorTools(params: {
  client: GatewayClient | null;
}): Promise<ConnectorToolSummary[]> {
  const capabilities = await listConnectorCapabilities(params);
  return buildConnectorToolSummaries(capabilities);
}

export function listConnectorToolsForAccountSync(params: {
  ownerAccountId: string;
}): ConnectorToolSummary[] {
  const capabilities = listConnectorCapabilitiesForAccountSync(params);
  return buildConnectorToolSummaries(capabilities);
}

function buildConnectorToolSummaries(capabilities: ConnectorCapability[]): ConnectorToolSummary[] {
  return capabilities.flatMap((capability) =>
    capability.actions.map((action) => ({
      toolName: buildConnectorToolName({
        instanceId: capability.instanceId,
        action: action.name,
      }),
      instanceId: capability.instanceId,
      providerId: capability.providerId,
      action: action.name,
      description: action.description,
      access: action.access,
      riskLevel: action.riskLevel,
      requiresApproval: action.effectivePolicy === "approval",
    })),
  );
}

async function requestConnectorApproval(params: {
  context: GatewayRequestContext;
  client: GatewayClient | null;
  instance: ConnectorInstance;
  actionName: string;
  args: Record<string, unknown>;
}) {
  const manager = params.context.pluginApprovalManager;
  if (!manager) {
    throw new Error("plugin approval manager unavailable");
  }
  const payload: PluginApprovalRequestPayload = {
    pluginId: `connector:${params.instance.providerId}`,
    title: `Connector approval: ${params.instance.displayName}`,
    description: `Allow action ${params.actionName} on ${params.instance.displayName}?\n${JSON.stringify(
      params.args,
      null,
      2,
    ).slice(0, 400)}`,
    severity: "warning",
    toolName: params.actionName,
    toolCallId: params.instance.id,
    agentId: null,
    sessionKey: null,
    turnSourceChannel: null,
    turnSourceTo: null,
    turnSourceAccountId: resolveOwnerAccountId(params.client),
    turnSourceThreadId: null,
  };
  const record = manager.create(payload, 15 * 60_000, `connector:${randomUUID()}`);
  const decisionPromise = manager.register(record, 15 * 60_000);
  const decision = await decisionPromise;
  if (!decision || !decision.startsWith("allow")) {
    throw new Error("connector action approval denied or expired");
  }
}

export async function invokeConnectorAction(params: {
  context: GatewayRequestContext;
  client: GatewayClient | null;
  instanceId: string;
  action: string;
  args?: Record<string, unknown>;
}) {
  return await invokeConnectorActionForAccount({
    ownerAccountId: resolveOwnerAccountId(params.client),
    instanceId: params.instanceId,
    action: params.action,
    args: params.args,
    requestApproval: async ({ instance, actionName, args }) => {
      await requestConnectorApproval({
        context: params.context,
        client: params.client,
        instance,
        actionName,
        args,
      });
    },
  });
}

export async function invokeConnectorActionForAccount(params: {
  ownerAccountId: string;
  instanceId: string;
  action: string;
  args?: Record<string, unknown>;
  requestApproval?: (args: {
    instance: ConnectorInstance;
    actionName: string;
    args: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const instance = await getConnectorInstance(params.instanceId);
  if (!instance) {
    throw new Error(`connector instance not found: ${params.instanceId}`);
  }
  if (instance.ownerAccountId !== params.ownerAccountId) {
    throw new Error("connector instance is not owned by the current account");
  }
  if (!instance.enabled) {
    throw new Error("connector instance is disabled");
  }
  const provider = getConnectorProvider(instance.providerId);
  if (!provider) {
    throw new Error(`unknown connector provider: ${instance.providerId}`);
  }
  const actionDefinition = provider.definition.actions.find((item) => item.name === params.action);
  if (!actionDefinition) {
    throw new Error(`unknown connector action: ${params.action}`);
  }
  const effectivePolicy = resolveConnectorActionPolicy({
    policy: instance.policy,
    action: actionDefinition,
  });
  if (effectivePolicy === "deny") {
    throw new Error(`connector action denied by policy: ${params.action}`);
  }
  if (effectivePolicy === "approval") {
    if (!params.requestApproval) {
      throw new Error("connector action requires approval");
    }
    await params.requestApproval({
      instance,
      actionName: params.action,
      args: params.args ?? {},
    });
  }
  const secrets = await resolveSecretInputs(instance.secretInputs);
  const result = await provider.invoke({
    action: params.action,
    config: instance.config,
    secrets,
    args: params.args ?? {},
  });
  await appendConnectorAudit({
    id: `audit_${randomUUID()}`,
    ts: Date.now(),
    instanceId: instance.id,
    providerId: instance.providerId,
    action: params.action,
    ok: result.ok,
    actor: params.ownerAccountId,
    message: result.ok ? "ok" : (normalizeOptionalString(result.error) ?? "failed"),
  });
  return result;
}

export function getConnectorInstanceForAccountSync(params: {
  ownerAccountId: string;
  instanceId: string;
}): ConnectorInstance | null {
  const instance = getConnectorInstanceSync(params.instanceId);
  if (!instance || instance.ownerAccountId !== params.ownerAccountId) {
    return null;
  }
  return instance;
}
