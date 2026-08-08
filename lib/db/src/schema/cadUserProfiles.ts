import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const cadUserProfilesTable = pgTable("cad_user_profiles", {
  id: serial("id").primaryKey(),
  auth_user_id: text("auth_user_id"),
  username: text("username").notNull(),
  discord_username: text("discord_username").notNull().default(""),
  discord_id: text("discord_id").notNull().default(""),
  avatar_hash: text("avatar_hash").notNull().default(""),
  email: text("email").notNull().unique(),
  community_code: text("community_code").notNull().default(""),
  status: text("status").notNull().default("active"),
  rank: text("rank").notNull().default("Member"),
  role: text("role").notNull().default("Community Members"),
  password_salt: text("password_salt"),
  password_hash: text("password_hash"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});
