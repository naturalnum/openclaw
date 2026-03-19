import { relations } from "drizzle-orm";
import { users, sessions, skills, versions, reviews } from "./schema.js";

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  skills: many(skills),
  reviews: many(reviews),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const skillsRelations = relations(skills, ({ one, many }) => ({
  owner: one(users, { fields: [skills.ownerId], references: [users.id] }),
  versions: many(versions),
}));

export const versionsRelations = relations(versions, ({ one, many }) => ({
  skill: one(skills, { fields: [versions.skillId], references: [skills.id] }),
  uploader: one(users, { fields: [versions.uploadedBy], references: [users.id] }),
  reviews: many(reviews),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  version: one(versions, { fields: [reviews.versionId], references: [versions.id] }),
  reviewer: one(users, { fields: [reviews.reviewerId], references: [users.id] }),
}));
