import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
})

export type User = typeof users.$inferSelect

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
    source: text('source', { enum: ['manual'] })
      .notNull()
      .default('manual'),
    servingSize: text('serving_size').notNull(),
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
