import {
  createConnectorInstanceForClient,
  getConnectorCatalogEntry,
  invokeConnectorAction,
  listConnectorCapabilities,
  listConnectorCatalog,
  listConnectorTools,
  listOwnedConnectorInstances,
  removeConnectorInstanceForClient,
  setConnectorInstanceEnabled,
  testConnectorInstanceForClient,
  updateConnectorInstanceForClient,
} from "../../connectors/runtime.js";
import { getConnectorInstance } from "../../connectors/storage.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateConnectorCapabilitiesListParams,
  validateConnectorCatalogGetParams,
  validateConnectorCatalogListParams,
  validateConnectorInstanceDeleteParams,
  validateConnectorInstanceGetParams,
  validateConnectorInstanceSetEnabledParams,
  validateConnectorInstanceUpsertParams,
  validateConnectorInstancesListParams,
  validateConnectorInvokeParams,
  validateConnectorToolsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function resolveOwnerAccountId(client: { connect?: { client?: { instanceId?: string } } } | null) {
  return client?.connect?.client?.instanceId?.trim() || "default";
}

export const connectorsHandlers: GatewayRequestHandlers = {
  "connectors.catalog.list": async ({ params, respond }) => {
    if (!validateConnectorCatalogListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.catalog.list params: ${formatValidationErrors(
            validateConnectorCatalogListParams.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, { providers: await listConnectorCatalog() }, undefined);
  },
  "connectors.catalog.get": async ({ params, respond }) => {
    if (!validateConnectorCatalogGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.catalog.get params: ${formatValidationErrors(
            validateConnectorCatalogGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    const provider = await getConnectorCatalogEntry((params as { providerId: string }).providerId);
    if (!provider) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "connector provider not found"),
      );
      return;
    }
    respond(true, provider, undefined);
  },
  "connectors.instances.list": async ({ params, client, respond }) => {
    if (!validateConnectorInstancesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.list params: ${formatValidationErrors(
            validateConnectorInstancesListParams.errors,
          )}`,
        ),
      );
      return;
    }
    const accountId = resolveOwnerAccountId(client);
    respond(true, { instances: await listOwnedConnectorInstances(accountId) }, undefined);
  },
  "connectors.instances.get": async ({ params, client, respond }) => {
    if (!validateConnectorInstanceGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.get params: ${formatValidationErrors(
            validateConnectorInstanceGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    const instance = await getConnectorInstance((params as { id: string }).id);
    if (!instance || instance.ownerAccountId !== resolveOwnerAccountId(client)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "connector instance not found"),
      );
      return;
    }
    respond(true, instance, undefined);
  },
  "connectors.instances.create": async ({ params, client, respond }) => {
    if (!validateConnectorInstanceUpsertParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.create params: ${formatValidationErrors(
            validateConnectorInstanceUpsertParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const p = params as {
        providerId: string;
        displayName: string;
        description?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
        secretInputs?: Record<string, unknown>;
        policy?: {
          mode?: "read-only" | "limited-write" | "full";
          allowedActions?: string[];
          deniedActions?: string[];
          requireApprovalActions?: string[];
        };
      };
      const instance = await createConnectorInstanceForClient({
        client,
        providerId: p.providerId,
        displayName: p.displayName,
        description: p.description,
        enabled: p.enabled,
        config: p.config,
        secretInputs: p.secretInputs,
        policy: p.policy,
      });
      respond(true, { ok: true, instance }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
    }
  },
  "connectors.instances.update": async ({ params, client, respond }) => {
    if (!validateConnectorInstanceUpsertParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.update params: ${formatValidationErrors(
            validateConnectorInstanceUpsertParams.errors,
          )}`,
        ),
      );
      return;
    }
    const id = (params as { id?: string }).id?.trim();
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      const p = params as {
        id: string;
        displayName: string;
        description?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
        secretInputs?: Record<string, unknown>;
        policy?: {
          mode?: "read-only" | "limited-write" | "full";
          allowedActions?: string[];
          deniedActions?: string[];
          requireApprovalActions?: string[];
        };
      };
      const instance = await updateConnectorInstanceForClient({
        client,
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        enabled: p.enabled,
        config: p.config,
        secretInputs: p.secretInputs,
        policy: p.policy,
      });
      respond(true, { ok: true, instance }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
    }
  },
  "connectors.instances.delete": async ({ params, client, respond }) => {
    if (!validateConnectorInstanceDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.delete params: ${formatValidationErrors(
            validateConnectorInstanceDeleteParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const id = (params as { id: string }).id;
      const removed = await removeConnectorInstanceForClient({ client, id });
      respond(true, { ok: true, removed, id }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
    }
  },
  "connectors.instances.enable": async ({ params, client, respond }) => {
    if (!validateConnectorInstanceSetEnabledParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.enable params: ${formatValidationErrors(
            validateConnectorInstanceSetEnabledParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const p = params as { id: string; enabled: boolean };
      const instance = await setConnectorInstanceEnabled({ client, id: p.id, enabled: p.enabled });
      respond(true, { ok: true, instance }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
    }
  },
  "connectors.instances.disable": async ({ params, client, respond }) => {
    if (!validateConnectorInstanceSetEnabledParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.disable params: ${formatValidationErrors(
            validateConnectorInstanceSetEnabledParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const p = params as { id: string; enabled: boolean };
      const instance = await setConnectorInstanceEnabled({ client, id: p.id, enabled: p.enabled });
      respond(true, { ok: true, instance }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
    }
  },
  "connectors.instances.test": async ({ params, client, respond }) => {
    if (!validateConnectorInstanceGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.instances.test params: ${formatValidationErrors(
            validateConnectorInstanceGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await testConnectorInstanceForClient({
        client,
        id: (params as { id: string }).id,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
    }
  },
  "connectors.capabilities.list": async ({ params, client, respond }) => {
    if (!validateConnectorCapabilitiesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.capabilities.list params: ${formatValidationErrors(
            validateConnectorCapabilitiesListParams.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, { capabilities: await listConnectorCapabilities({ client }) }, undefined);
  },
  "connectors.tools.list": async ({ params, client, respond }) => {
    if (!validateConnectorToolsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.tools.list params: ${formatValidationErrors(
            validateConnectorToolsListParams.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, { tools: await listConnectorTools({ client }) }, undefined);
  },
  "connectors.invoke": async ({ params, client, context, respond }) => {
    if (!validateConnectorInvokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.invoke params: ${formatValidationErrors(
            validateConnectorInvokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const p = params as {
        instanceId: string;
        action: string;
        args?: Record<string, unknown>;
      };
      const result = await invokeConnectorAction({
        context,
        client,
        instanceId: p.instanceId,
        action: p.action,
        args: p.args,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, getErrorMessage(err)));
    }
  },
};
