import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);

export const SkillsRegistryCategorySchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    icon: Type.Optional(Type.String()),
    bgColor: Type.Optional(Type.String()),
    textColor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SkillsRegistryInstallStateSchema = Type.Object(
  {
    installed: Type.Boolean(),
    installedVersion: NullableString,
    latestVersion: NullableString,
    managed: Type.Boolean(),
    canUninstall: Type.Boolean(),
    source: Type.Union([
      Type.Literal("openclaw-registry"),
      Type.Literal("clawhub-legacy"),
      Type.Literal("directory"),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const SkillsRegistryCatalogItemSchema = Type.Object(
  {
    slug: NonEmptyString,
    displayName: NonEmptyString,
    summary: Type.String(),
    category: Type.Union([NonEmptyString, Type.Null()]),
    tags: Type.Array(NonEmptyString),
    version: NullableString,
    downloads: Type.Integer({ minimum: 0 }),
    installs: Type.Integer({ minimum: 0 }),
    stars: Type.Integer({ minimum: 0 }),
    updatedAt: NullableNumber,
    author: NullableString,
    installState: SkillsRegistryInstallStateSchema,
  },
  { additionalProperties: false },
);

export const SkillsRegistryPaginationSchema = Type.Object(
  {
    page: Type.Integer({ minimum: 1 }),
    limit: Type.Integer({ minimum: 1 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const SkillsRegistryListParamsSchema = Type.Object(
  {
    q: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    sort: Type.Optional(
      Type.Union([
        Type.Literal("comprehensive"),
        Type.Literal("downloads"),
        Type.Literal("updated"),
      ]),
    ),
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    installFilter: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("installed"), Type.Literal("not_installed")]),
    ),
  },
  { additionalProperties: false },
);

export const SkillsRegistryListResultSchema = Type.Object(
  {
    baseUrl: Type.String(),
    categories: Type.Array(SkillsRegistryCategorySchema),
    items: Type.Array(SkillsRegistryCatalogItemSchema),
    pagination: SkillsRegistryPaginationSchema,
  },
  { additionalProperties: false },
);

export const SkillsRegistryInstallParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
    version: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SkillsRegistryInstallResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    slug: NonEmptyString,
    version: NullableString,
    targetDir: NonEmptyString,
    message: Type.String(),
    installState: SkillsRegistryInstallStateSchema,
  },
  { additionalProperties: false },
);

export const SkillsRegistryInstallArchiveParamsSchema = Type.Object(
  {
    fileName: NonEmptyString,
    archiveBase64: NonEmptyString,
    overwrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SkillsRegistryInstallArchiveResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    slug: NonEmptyString,
    version: NullableString,
    targetDir: NonEmptyString,
    message: Type.String(),
    installState: SkillsRegistryInstallStateSchema,
  },
  { additionalProperties: false },
);

export const SkillsRegistryUninstallParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillsRegistryUninstallResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    slug: NonEmptyString,
    removed: Type.Boolean(),
    targetDir: NonEmptyString,
    message: Type.String(),
    installState: SkillsRegistryInstallStateSchema,
  },
  { additionalProperties: false },
);
