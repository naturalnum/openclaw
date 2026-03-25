import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const WorkspaceRelativePathSchema = Type.String({ minLength: 0 });

export const WorkspacePreviewKindSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("image"),
  Type.Literal("pdf"),
  Type.Literal("none"),
]);

export const WorkspaceEntrySchema = Type.Object(
  {
    name: NonEmptyString,
    path: NonEmptyString,
    kind: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
    mimeType: Type.Optional(NonEmptyString),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    updatedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    previewKind: Type.Optional(WorkspacePreviewKindSchema),
    extension: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkspaceListParamsSchema = Type.Object(
  {
    path: Type.Optional(WorkspaceRelativePathSchema),
  },
  { additionalProperties: false },
);

export const WorkspaceListResultSchema = Type.Object(
  {
    root: NonEmptyString,
    currentPath: Type.String(),
    parentPath: Type.Union([Type.String(), Type.Null()]),
    entries: Type.Array(WorkspaceEntrySchema),
  },
  { additionalProperties: false },
);

export const WorkspaceDownloadParamsSchema = Type.Object(
  {
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceDownloadResultSchema = Type.Object(
  {
    file: Type.Object(
      {
        name: NonEmptyString,
        path: NonEmptyString,
        mimeType: Type.String(),
        size: Type.Integer({ minimum: 0 }),
        contentBase64: NonEmptyString,
        previewKind: WorkspacePreviewKindSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const WorkspaceMkdirParamsSchema = Type.Object(
  {
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceDeleteParamsSchema = Type.Object(
  {
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceRenameParamsSchema = Type.Object(
  {
    path: NonEmptyString,
    newName: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceUploadFileSchema = Type.Object(
  {
    name: NonEmptyString,
    contentBase64: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkspaceUploadParamsSchema = Type.Object(
  {
    path: Type.Optional(WorkspaceRelativePathSchema),
    files: Type.Array(WorkspaceUploadFileSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const WorkspaceWriteResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
  },
  { additionalProperties: false },
);
