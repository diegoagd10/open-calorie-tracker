import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
})

export type User = typeof users.$inferSelect

// Each user's serving sizes; their food entries point to them. A user has each name once,
// regardless of case.
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

// Where food entries come from. The migration adds every source the app knows.
export const foodSources = sqliteTable('food_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { enum: ['manual'] })
    .notNull()
    .unique(),
})

export type FoodSource = (typeof foodSources.$inferSelect)['name']

// Nutrients are nullable: an entry may not have data for every one of them.
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
  },
  (table) => [index('food_entries_user_logged_at').on(table.userId, table.loggedAt)],
)

export type FoodEntry = typeof foodEntries.$inferSelect

// Amount in US fluid ounces.
export const waterEntries = sqliteTable(
  'water_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    loggedAt: integer('logged_at', { mode: 'timestamp_ms' }).notNull(),
    amount: real('amount').notNull(),
  },
  (table) => [index('water_entries_user_logged_at').on(table.userId, table.loggedAt)],
)

export type WaterEntry = typeof waterEntries.$inferSelect

// One row per user who changed a goal; a user without one has the default goals.
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
