import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
})

export type User = typeof users.$inferSelect

export const servingSizes = sqliteTable(
  'serving_sizes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
  },
  (table) => [
    uniqueIndex('serving_sizes_user_name_unique').on(
      table.userId,
      sql`${table.name} COLLATE NOCASE`,
    ),
  ],
)

export type ServingSize = typeof servingSizes.$inferSelect

export const foodSources = sqliteTable('food_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { enum: ['manual'] })
    .notNull()
    .unique(),
})

export type FoodSource = (typeof foodSources.$inferSelect)['name']

export const foodEntries = sqliteTable(
  'food_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    loggedAt: integer('logged_at', { mode: 'timestamp_ms' }).notNull(),
    name: text('name').notNull(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => foodSources.id),
    servingSizeId: integer('serving_size_id')
      .notNull()
      .references(() => servingSizes.id),
    quantity: real('quantity').notNull(),
    calories: real('calories').notNull(),
    protein: real('protein'),
    carbohydrate: real('carbohydrate'),
    fat: real('fat'),
    fiber: real('fiber'),
    sugar: real('sugar'),
    sodium: real('sodium'),
    requestId: text('request_id'),
    attempt: integer('attempt').notNull().default(1),
  },
  (table) => [
    index('food_entries_user_logged_at').on(table.userId, table.loggedAt),
    uniqueIndex('food_entries_user_request_unique').on(table.userId, table.requestId),
  ],
)

export type FoodEntry = typeof foodEntries.$inferSelect

export const waterEntries = sqliteTable(
  'water_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    loggedAt: integer('logged_at', { mode: 'timestamp_ms' }).notNull(),
    amount: real('amount').notNull(),
    requestId: text('request_id'),
    attempt: integer('attempt').notNull().default(1),
  },
  (table) => [
    index('water_entries_user_logged_at').on(table.userId, table.loggedAt),
    uniqueIndex('water_entries_user_request_unique').on(table.userId, table.requestId),
  ],
)

export type WaterEntry = typeof waterEntries.$inferSelect

export const dailyGoals = sqliteTable('daily_goals', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  calories: integer('calories').notNull(),
  protein: integer('protein').notNull(),
  carbohydrate: integer('carbohydrate').notNull(),
  fat: integer('fat').notNull(),
  fiber: integer('fiber').notNull(),
  sugar: integer('sugar').notNull(),
  sodium: integer('sodium').notNull(),
  water: integer('water').notNull(),
})

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    preview: text('preview').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('api_keys_user_name_unique').on(table.userId, sql`${table.name} COLLATE NOCASE`),
    index('api_keys_user_created_at').on(table.userId, table.createdAt),
  ],
)

export const weightEntries = sqliteTable(
  'weight_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    weight: real('weight').notNull(),
  },
  (table) => [uniqueIndex('weight_entries_user_date_unique').on(table.userId, table.date)],
)

export const weightGoals = sqliteTable('weight_goals', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  startWeight: real('start_weight').notNull(),
  goalWeight: real('goal_weight').notNull(),
  startDate: text('start_date').notNull(),
})
