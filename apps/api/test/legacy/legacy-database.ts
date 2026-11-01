import { type Client, createClient } from '@libsql/client'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCHEMA_PATH = new URL('./schema.sql', import.meta.url)

const TIMESTAMP = '2026-10-01T12:00:00.000Z'

// A Food Event as the old app stored it. Its nutrients are already the totals for the quantity
// eaten: kcal and grams in thousandths (milli-kcal, milligrams), sodium in whole milligrams. A
// measurement in g or ml is stored as an Open Food Facts food, one in servings as a manual food.
export type LegacyFood = {
  logDate: string
  originalName: string
  editedName?: string | null
  measurement: { label: string; unit: 'g' | 'ml' | 'serving'; base: number }
  quantity: number
  energyMilliKcal: number | null
  proteinMilligrams?: number | null
  carbohydrateMilligrams?: number | null
  fatMilligrams?: number | null
  fiberMilligrams?: number | null
  sugarMilligrams?: number | null
  sodiumMilligrams?: number | null
}

export type LegacyGoals = {
  calorieMilliKcal: number
  waterOunces: string
  proteinMilligrams: number
  carbohydrateMilligrams: number
  fatMilligrams: number
  fiberMilligrams: number
  sugarMilligrams: number
  sodiumMilligrams: number
}

const microunits = (value: number) => Math.round(value * 1_000_000)

// An open-calory-tracker database in a temporary folder, with only the tables the import reads.
export class LegacyDatabase {
  private constructor(
    private readonly directory: string,
    private readonly client: Client,
    readonly path: string,
  ) {}

  get url() {
    return `file:${this.path}`
  }

  static async create(): Promise<LegacyDatabase> {
    const directory = await mkdtemp(join(tmpdir(), 'open-calorie-tracker-legacy-'))
    const path = join(directory, 'open-calory-tracker.sqlite')
    const client = createClient({ url: `file:${path}` })
    await client.executeMultiple(await readFile(SCHEMA_PATH, 'utf8'))
    return new LegacyDatabase(directory, client, path)
  }

  // Only the username: the import never reads passwords.
  async addUser(username: string): Promise<number> {
    const result = await this.client.execute({
      sql: 'INSERT INTO users (username_normalized, created_at) VALUES (?, ?)',
      args: [username, TIMESTAMP],
    })
    return Number(result.lastInsertRowid)
  }

  async addFood(userId: number, food: LegacyFood): Promise<void> {
    const { label, unit, base } = food.measurement
    const manual = unit === 'serving'
    await this.client.execute({
      sql: `INSERT INTO food_events (
        user_id, log_date, provider, provider_food_id, source_data_type, original_name,
        edited_name, authoritative_base_unit, authoritative_base_quantity_microunits,
        selected_measurement_id, selected_measurement_label, selected_measurement_unit,
        selected_measurement_base_quantity_microunits, quantity_microunits,
        authoritative_energy_milli_kcal, authoritative_protein_milligrams,
        authoritative_carbohydrate_milligrams, authoritative_fat_milligrams,
        authoritative_fiber_milligrams, authoritative_sugar_milligrams,
        authoritative_sodium_milligrams, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId,
        food.logDate,
        manual ? 'manual' : 'open-food-facts',
        'provider-food-id',
        manual ? 'User entered' : 'Open Food Facts',
        food.originalName,
        food.editedName ?? null,
        unit,
        microunits(manual ? 1 : base),
        'measurement-id',
        label,
        unit,
        microunits(base),
        microunits(food.quantity),
        food.energyMilliKcal,
        food.proteinMilligrams ?? null,
        food.carbohydrateMilligrams ?? null,
        food.fatMilligrams ?? null,
        food.fiberMilligrams ?? null,
        food.sugarMilligrams ?? null,
        food.sodiumMilligrams ?? null,
        TIMESTAMP,
        TIMESTAMP,
      ],
    })
  }

  async addWater(userId: number, water: { logDate: string; ounces: string }): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO water_events (user_id, log_date, ounces, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`,
      args: [userId, water.logDate, water.ounces, TIMESTAMP, TIMESTAMP],
    })
  }

  async addGoals(userId: number, goals: LegacyGoals): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO daily_goals (
        user_id, calorie_target_milli_kcal, water_target_ounces, protein_target_milligrams,
        carbohydrate_target_milligrams, fat_target_milligrams, fiber_target_milligrams,
        sugar_maximum_milligrams, sodium_maximum_milligrams, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId,
        goals.calorieMilliKcal,
        goals.waterOunces,
        goals.proteinMilligrams,
        goals.carbohydrateMilligrams,
        goals.fatMilligrams,
        goals.fiberMilligrams,
        goals.sugarMilligrams,
        goals.sodiumMilligrams,
        TIMESTAMP,
        TIMESTAMP,
      ],
    })
  }

  async remove(): Promise<void> {
    this.client.close()
    await rm(this.directory, { recursive: true, force: true })
  }
}
