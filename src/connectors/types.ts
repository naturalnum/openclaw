import type { TSchema } from "@sinclair/typebox";
import type { SecretInput } from "../config/types.secrets.js";

export type ConnectorFieldKind = "text" | "textarea" | "number" | "boolean";
export type ConnectorCategory = "database" | "email" | "scm" | "saas" | "internal";
export type ConnectorActionAccess = "read" | "write";
export type ConnectorRiskLevel = "low" | "medium" | "high" | "critical";
export type ConnectorActionPolicy = "allow" | "approval" | "deny";
export type ConnectorAuthType = "none" | "basic" | "token" | "oauth2" | "app";
export type ConnectorInstanceStatus = "draft" | "active" | "error" | "revoked";
export type ConnectorHealthStatus = "unknown" | "healthy" | "degraded" | "error";
export type ConnectorPolicyMode = "read-only" | "limited-write" | "full";

export type ConnectorFieldDefinition = {
  key: string;
  label: string;
  kind: ConnectorFieldKind;
  required?: boolean;
  placeholder?: string;
  description?: string;
};

export type ConnectorActionDefinition = {
  name: string;
  displayName: string;
  description: string;
  access: ConnectorActionAccess;
  riskLevel: ConnectorRiskLevel;
  defaultPolicy: ConnectorActionPolicy;
  inputSchema?: TSchema;
};

export type ConnectorProviderDefinition = {
  id: string;
  displayName: string;
  description: string;
  category: ConnectorCategory;
  authType: ConnectorAuthType;
  configFields: ConnectorFieldDefinition[];
  secretFields: ConnectorFieldDefinition[];
  actions: ConnectorActionDefinition[];
};

export type ConnectorInstancePolicy = {
  mode: ConnectorPolicyMode;
  allowedActions: string[];
  deniedActions: string[];
  requireApprovalActions: string[];
};

export type ConnectorInstance = {
  id: string;
  ownerAccountId: string;
  providerId: string;
  connectorType: string;
  displayName: string;
  description: string;
  enabled: boolean;
  status: ConnectorInstanceStatus;
  config: Record<string, unknown>;
  secretInputs: Record<string, SecretInput>;
  policy: ConnectorInstancePolicy;
  health: {
    status: ConnectorHealthStatus;
    lastCheckedAt: number | null;
    lastError: string | null;
  };
  createdAt: number;
  updatedAt: number;
};

export type ConnectorCapability = {
  instanceId: string;
  providerId: string;
  displayName: string;
  enabled: boolean;
  actions: Array<
    ConnectorActionDefinition & {
      effectivePolicy: ConnectorActionPolicy;
    }
  >;
};

export type ConnectorToolSummary = {
  toolName: string;
  instanceId: string;
  providerId: string;
  action: string;
  description: string;
  access: ConnectorActionAccess;
  riskLevel: ConnectorRiskLevel;
  requiresApproval: boolean;
};

export type ConnectorInvokeResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  approval?: {
    required: boolean;
    id?: string;
    title?: string;
  };
};

export type ConnectorResolvedSecrets = Record<string, string>;

export type ConnectorValidationResult =
  | { ok: true }
  | {
      ok: false;
      errors: string[];
    };

export type ConnectorTestResult = {
  ok: boolean;
  message: string;
  diagnostics?: string[];
};

export type ConnectorProviderRuntime = {
  definition: ConnectorProviderDefinition;
  validate(params: {
    config: Record<string, unknown>;
    secretInputs: Record<string, SecretInput>;
  }): Promise<ConnectorValidationResult>;
  testConnection(params: {
    config: Record<string, unknown>;
    secrets: ConnectorResolvedSecrets;
  }): Promise<ConnectorTestResult>;
  invoke(params: {
    action: string;
    config: Record<string, unknown>;
    secrets: ConnectorResolvedSecrets;
    args: Record<string, unknown>;
  }): Promise<ConnectorInvokeResult>;
};

export function createDefaultConnectorPolicy(): ConnectorInstancePolicy {
  return {
    mode: "read-only",
    allowedActions: [],
    deniedActions: [],
    requireApprovalActions: [],
  };
}
