import { Type } from "@sinclair/typebox";
import {
  buildConnectorToolName,
  invokeConnectorActionForAccount,
  listConnectorCapabilitiesForAccountSync,
} from "../../connectors/runtime.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { PluginApprovalResolutions } from "../../plugins/types.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const log = createSubsystemLogger("connector-tools");

function buildFallbackSchema() {
  return Type.Object(
    {
      payload: Type.Optional(Type.Any()),
    },
    { additionalProperties: true },
  );
}

async function requestApproval(params: {
  providerId: string;
  instanceId: string;
  displayName: string;
  actionName: string;
  args: Record<string, unknown>;
  agentId?: string;
  sessionKey?: string;
  signal?: AbortSignal;
}) {
  const description = `Allow action ${params.actionName} on ${params.displayName}?\n${JSON.stringify(
    params.args,
    null,
    2,
  ).slice(0, 400)}`;
  const requestResult = await callGatewayTool(
    "plugin.approval.request",
    { timeoutMs: 130_000 },
    {
      pluginId: `connector:${params.providerId}`,
      title: `Connector approval: ${params.displayName}`,
      description,
      severity: "warning",
      toolName: params.actionName,
      toolCallId: params.instanceId,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      timeoutMs: 120_000,
      twoPhase: true,
    },
    { expectFinal: false },
  );
  const requestId = normalizeOptionalString((requestResult as { id?: unknown })?.id);
  if (!requestId) {
    throw new Error("connector approval request failed");
  }

  const waitPromise = callGatewayTool(
    "plugin.approval.waitDecision",
    { timeoutMs: 130_000 },
    { id: requestId },
  );
  const waitResult = params.signal
    ? await (() => {
        let onAbort: (() => void) | undefined;
        const abortPromise = new Promise<never>((_, reject) => {
          if (params.signal?.aborted) {
            reject(params.signal.reason);
            return;
          }
          onAbort = () => reject(params.signal?.reason);
          params.signal?.addEventListener("abort", onAbort, { once: true });
        });
        return Promise.race([waitPromise, abortPromise]).finally(() => {
          if (onAbort) {
            params.signal?.removeEventListener("abort", onAbort);
          }
        });
      })()
    : await waitPromise;
  const decision = waitResult?.decision;
  if (
    decision !== PluginApprovalResolutions.ALLOW_ONCE &&
    decision !== PluginApprovalResolutions.ALLOW_ALWAYS
  ) {
    throw new Error(
      decision === PluginApprovalResolutions.DENY
        ? "connector action denied by user"
        : "connector approval timed out",
    );
  }
}

export function createConnectorAgentTools(params: {
  ownerAccountId?: string | null;
  agentId?: string;
  sessionKey?: string;
  abortSignal?: AbortSignal;
}): AnyAgentTool[] {
  const ownerAccountId = normalizeOptionalString(params.ownerAccountId) ?? "default";

  const capabilities = listConnectorCapabilitiesForAccountSync({ ownerAccountId });
  return capabilities.flatMap((capability) =>
    capability.actions.map((action) => {
      const toolName = buildConnectorToolName({
        instanceId: capability.instanceId,
        action: action.name,
      });
      return {
        name: toolName,
        label: `${capability.displayName}: ${action.displayName}`,
        description: [
          action.description,
          `Connector: ${capability.displayName}`,
          `Provider: ${capability.providerId}`,
          action.effectivePolicy === "approval" ? "Requires approval before execution." : null,
        ]
          .filter(Boolean)
          .join(" "),
        parameters: action.inputSchema ?? buildFallbackSchema(),
        execute: async (_toolCallId: string, args: unknown) => {
          const paramsRecord =
            args && typeof args === "object" && !Array.isArray(args)
              ? (args as Record<string, unknown>)
              : {};
          const result = await invokeConnectorActionForAccount({
            ownerAccountId,
            instanceId: capability.instanceId,
            action: action.name,
            args: paramsRecord,
            requestApproval:
              action.effectivePolicy === "approval"
                ? async ({ instance, actionName, args }) => {
                    await requestApproval({
                      providerId: instance.providerId,
                      instanceId: instance.id,
                      displayName: instance.displayName,
                      actionName,
                      args,
                      agentId: params.agentId,
                      sessionKey: params.sessionKey,
                      signal: params.abortSignal,
                    });
                  }
                : undefined,
          });
          if (!result.ok) {
            const message = normalizeOptionalString(result.error) ?? "connector action failed";
            log.warn(`${toolName} failed: ${message}`);
            throw new Error(message);
          }
          return jsonResult(result.data ?? { ok: true });
        },
      } satisfies AnyAgentTool;
    }),
  );
}
