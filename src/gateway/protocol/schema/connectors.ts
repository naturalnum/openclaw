import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
const StringListSchema = Type.Array(NonEmptyString);
const UnknownRecordSchema = Type.Record(NonEmptyString, Type.Unknown());

export const ConnectorFieldDefinitionSchema = Type.Object(
  {
    key: NonEmptyString,
    label: NonEmptyString,
    kind: Type.Union([
      Type.Literal("text"),
      Type.Literal("textarea"),
      Type.Literal("number"),
      Type.Literal("boolean"),
    ]),
    required: Type.Optional(Type.Boolean()),
    placeholder: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ConnectorActionDefinitionSchema = Type.Object(
  {
    name: NonEmptyString,
    displayName: NonEmptyString,
    description: Type.String(),
    access: Type.Union([Type.Literal("read"), Type.Literal("write")]),
    riskLevel: Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("critical"),
    ]),
    defaultPolicy: Type.Union([
      Type.Literal("allow"),
      Type.Literal("approval"),
      Type.Literal("deny"),
    ]),
  },
  { additionalProperties: false },
);

export const ConnectorProviderDefinitionSchema = Type.Object(
  {
    id: NonEmptyString,
    displayName: NonEmptyString,
    description: Type.String(),
    category: Type.Union([
      Type.Literal("database"),
      Type.Literal("email"),
      Type.Literal("scm"),
      Type.Literal("saas"),
      Type.Literal("internal"),
    ]),
    authType: Type.Union([
      Type.Literal("none"),
      Type.Literal("basic"),
      Type.Literal("token"),
      Type.Literal("oauth2"),
      Type.Literal("app"),
    ]),
    configFields: Type.Array(ConnectorFieldDefinitionSchema),
    secretFields: Type.Array(ConnectorFieldDefinitionSchema),
    actions: Type.Array(ConnectorActionDefinitionSchema),
  },
  { additionalProperties: false },
);

export const ConnectorCatalogListParamsSchema = Type.Object({}, { additionalProperties: false });

export const ConnectorCatalogGetParamsSchema = Type.Object(
  {
    providerId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ConnectorCatalogListResultSchema = Type.Object(
  {
    providers: Type.Array(ConnectorProviderDefinitionSchema),
  },
  { additionalProperties: false },
);

export const ConnectorInstancePolicySchema = Type.Object(
  {
    mode: Type.Union([
      Type.Literal("read-only"),
      Type.Literal("limited-write"),
      Type.Literal("full"),
    ]),
    allowedActions: StringListSchema,
    deniedActions: StringListSchema,
    requireApprovalActions: StringListSchema,
  },
  { additionalProperties: false },
);

export const ConnectorInstanceSchema = Type.Object(
  {
    id: NonEmptyString,
    ownerAccountId: NonEmptyString,
    providerId: NonEmptyString,
    connectorType: NonEmptyString,
    displayName: NonEmptyString,
    description: Type.String(),
    enabled: Type.Boolean(),
    status: Type.Union([
      Type.Literal("draft"),
      Type.Literal("active"),
      Type.Literal("error"),
      Type.Literal("revoked"),
    ]),
    config: UnknownRecordSchema,
    secretInputs: UnknownRecordSchema,
    policy: ConnectorInstancePolicySchema,
    health: Type.Object(
      {
        status: Type.Union([
          Type.Literal("unknown"),
          Type.Literal("healthy"),
          Type.Literal("degraded"),
          Type.Literal("error"),
        ]),
        lastCheckedAt: NullableNumber,
        lastError: NullableString,
      },
      { additionalProperties: false },
    ),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ConnectorInstancesListParamsSchema = Type.Object({}, { additionalProperties: false });
export const ConnectorInstanceGetParamsSchema = Type.Object(
  {
    id: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ConnectorInstanceUpsertParamsSchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    providerId: NonEmptyString,
    displayName: NonEmptyString,
    description: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    config: Type.Optional(UnknownRecordSchema),
    secretInputs: Type.Optional(UnknownRecordSchema),
    policy: Type.Optional(ConnectorInstancePolicySchema),
  },
  { additionalProperties: false },
);

export const ConnectorInstanceDeleteParamsSchema = Type.Object(
  {
    id: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ConnectorInstanceSetEnabledParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ConnectorInstancesListResultSchema = Type.Object(
  {
    instances: Type.Array(ConnectorInstanceSchema),
  },
  { additionalProperties: false },
);

export const ConnectorInstanceMutationResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    instance: ConnectorInstanceSchema,
  },
  { additionalProperties: false },
);

export const ConnectorInstanceDeleteResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    removed: Type.Boolean(),
    id: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ConnectorCapabilitiesListParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const ConnectorCapabilitySchema = Type.Object(
  {
    instanceId: NonEmptyString,
    providerId: NonEmptyString,
    displayName: NonEmptyString,
    enabled: Type.Boolean(),
    actions: Type.Array(
      Type.Intersect([
        ConnectorActionDefinitionSchema,
        Type.Object(
          {
            effectivePolicy: Type.Union([
              Type.Literal("allow"),
              Type.Literal("approval"),
              Type.Literal("deny"),
            ]),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const ConnectorCapabilitiesListResultSchema = Type.Object(
  {
    capabilities: Type.Array(ConnectorCapabilitySchema),
  },
  { additionalProperties: false },
);

export const ConnectorToolSummarySchema = Type.Object(
  {
    toolName: NonEmptyString,
    instanceId: NonEmptyString,
    providerId: NonEmptyString,
    action: NonEmptyString,
    description: Type.String(),
    access: Type.Union([Type.Literal("read"), Type.Literal("write")]),
    riskLevel: Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("critical"),
    ]),
    requiresApproval: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ConnectorToolsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const ConnectorToolsListResultSchema = Type.Object(
  {
    tools: Type.Array(ConnectorToolSummarySchema),
  },
  { additionalProperties: false },
);

export const ConnectorInvokeParamsSchema = Type.Object(
  {
    instanceId: NonEmptyString,
    action: NonEmptyString,
    args: Type.Optional(UnknownRecordSchema),
  },
  { additionalProperties: false },
);

export const ConnectorInvokeResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    data: Type.Optional(Type.Unknown()),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
