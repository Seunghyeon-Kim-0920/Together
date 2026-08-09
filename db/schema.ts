import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  ageBand: text("age_band").notNull().default("unspecified"),
  smoking: text("smoking").notNull().default("unspecified"),
  drinking: text("drinking").notNull().default("unspecified"),
  mbti: text("mbti").notNull().default("unspecified"),
  updatedAt: text("updated_at").notNull(),
});

export const trips = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("trips_owner_updated_idx").on(table.ownerEmail, table.updatedAt)],
);

export const privateStates = sqliteTable(
  "private_states",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("private_states_owner_kind_idx").on(table.ownerEmail, table.kind)],
);

export const shareSnapshots = sqliteTable("share_snapshots", {
  tokenHash: text("token_hash").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});
