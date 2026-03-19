import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").unique().notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
);

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_sessions_expires").on(t.expiresAt),
    index("idx_sessions_user").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------

export const skills = pgTable(
  "skills",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").unique().notNull(),
    displayName: text("display_name").notNull(),
    summary: text("summary").default(""),
    tags: text("tags").default("[]"),
    ownerId: integer("owner_id").references(() => users.id),
    visibility: text("visibility").notNull().default("public"),
    downloads: integer("downloads").default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_skills_slug").on(t.slug),
    index("idx_skills_owner").on(t.ownerId),
    index("idx_skills_visibility").on(t.visibility),
    index("idx_skills_updated").on(t.updatedAt),
  ],
);

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------

export const versions = pgTable(
  "versions",
  {
    id: serial("id").primaryKey(),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    changelog: text("changelog").default(""),
    file: text("file").notNull(),
    fingerprint: text("fingerprint").default(""),
    size: integer("size").default(0),
    downloads: integer("downloads").default(0),
    reviewStatus: text("review_status").notNull().default("pending"),
    uploadedBy: integer("uploaded_by").references(() => users.id),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("versions_skill_version_unique").on(t.skillId, t.version),
    index("idx_versions_skill").on(t.skillId),
    index("idx_versions_status").on(t.reviewStatus),
  ],
);

// ---------------------------------------------------------------------------
// reviews
// ---------------------------------------------------------------------------

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    reviewerId: integer("reviewer_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    reason: text("reason").default(""),
    checkResults: text("check_results").default("{}"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_reviews_version").on(t.versionId),
  ],
);
