import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { SecretInput } from "../config/types.secrets.js";
import { CONFIG_DIR } from "../utils.js";
import type {
  ConnectorInstance,
  ConnectorInstancePolicy,
  ConnectorInstanceStatus,
} from "./types.js";
import { createDefaultConnectorPolicy } from "./types.js";

function resolveConnectorsRoot() {
  return path.join(CONFIG_DIR, "connectors");
}

function resolveInstancesDir() {
  return path.join(resolveConnectorsRoot(), "instances");
}

function resolveInstancePath(id: string) {
  return path.join(resolveInstancesDir(), `${id}.json`);
}

export function createConnectorId() {
  return `connector_${randomUUID()}`;
}

async function ensureInstancesDir() {
  await fsp.mkdir(resolveInstancesDir(), { recursive: true });
}

function ensureInstancesDirSync() {
  fs.mkdirSync(resolveInstancesDir(), { recursive: true });
}

export async function listConnectorInstances(): Promise<ConnectorInstance[]> {
  await ensureInstancesDir();
  const entries = await fsp.readdir(resolveInstancesDir(), { withFileTypes: true }).catch(() => []);
  const items: ConnectorInstance[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const raw = await fsp
      .readFile(path.join(resolveInstancesDir(), entry.name), "utf8")
      .catch(() => "");
    if (!raw) {
      continue;
    }
    try {
      items.push(JSON.parse(raw) as ConnectorInstance);
    } catch {
      // best-effort: ignore malformed connector files
    }
  }
  return items.toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export function listConnectorInstancesSync(): ConnectorInstance[] {
  ensureInstancesDirSync();
  const entries = fs.readdirSync(resolveInstancesDir(), { withFileTypes: true });
  const items: ConnectorInstance[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const raw = fs.readFileSync(path.join(resolveInstancesDir(), entry.name), "utf8");
    if (!raw) {
      continue;
    }
    try {
      items.push(JSON.parse(raw) as ConnectorInstance);
    } catch {
      // best-effort: ignore malformed connector files
    }
  }
  return items.toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConnectorInstance(id: string): Promise<ConnectorInstance | null> {
  const raw = await fsp.readFile(resolveInstancePath(id), "utf8").catch(() => "");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ConnectorInstance;
  } catch {
    return null;
  }
}

export function getConnectorInstanceSync(id: string): ConnectorInstance | null {
  try {
    const raw = fs.readFileSync(resolveInstancePath(id), "utf8");
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as ConnectorInstance;
  } catch {
    return null;
  }
}

export async function writeConnectorInstance(instance: ConnectorInstance): Promise<void> {
  await ensureInstancesDir();
  await fsp.writeFile(
    resolveInstancePath(instance.id),
    `${JSON.stringify(instance, null, 2)}\n`,
    "utf8",
  );
}

export async function deleteConnectorInstance(id: string): Promise<boolean> {
  try {
    await fsp.unlink(resolveInstancePath(id));
    return true;
  } catch {
    return false;
  }
}

export function buildConnectorInstance(params: {
  id?: string;
  ownerAccountId: string;
  providerId: string;
  connectorType?: string;
  displayName: string;
  description?: string;
  enabled?: boolean;
  status?: ConnectorInstanceStatus;
  config?: Record<string, unknown>;
  secretInputs?: Record<string, unknown>;
  policy?: Partial<ConnectorInstancePolicy>;
  createdAt?: number;
  health?: ConnectorInstance["health"];
}): ConnectorInstance {
  const now = Date.now();
  const basePolicy = createDefaultConnectorPolicy();
  return {
    id: params.id ?? createConnectorId(),
    ownerAccountId: params.ownerAccountId,
    providerId: params.providerId,
    connectorType: params.connectorType ?? params.providerId,
    displayName: params.displayName,
    description: params.description?.trim() ?? "",
    enabled: params.enabled ?? true,
    status: params.status ?? "draft",
    config: { ...params.config },
    secretInputs: { ...((params.secretInputs ?? {}) as Record<string, SecretInput>) },
    policy: {
      mode: params.policy?.mode ?? basePolicy.mode,
      allowedActions: [...(params.policy?.allowedActions ?? basePolicy.allowedActions)],
      deniedActions: [...(params.policy?.deniedActions ?? basePolicy.deniedActions)],
      requireApprovalActions: [
        ...(params.policy?.requireApprovalActions ?? basePolicy.requireApprovalActions),
      ],
    },
    health: params.health ?? {
      status: "unknown",
      lastCheckedAt: null,
      lastError: null,
    },
    createdAt: params.createdAt ?? now,
    updatedAt: now,
  };
}
