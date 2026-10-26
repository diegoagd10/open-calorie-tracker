import { Injectable } from '@nestjs/common'
import {
  DEFAULT_DAILY_GOALS,
  type DailyGoals,
  type DailyGoalsUpdate,
} from '@open-calorie-tracker/shared'
import { eq } from 'drizzle-orm'
import { Database } from '../../db/database.js'
import { dailyGoals } from '../../db/schema.js'

@Injectable()
export class DailyGoalsService {
  constructor(private readonly database: Database) {}

  async goalsOf(userId: number): Promise<DailyGoals> {
    const stored = await this.database.db.query.dailyGoals.findFirst({
      where: eq(dailyGoals.userId, userId),
      columns: { userId: false },
    })
    return stored ?? DEFAULT_DAILY_GOALS
  }

  // Changes the given goals and keeps the others. A user's first change starts from the defaults.
  async update(userId: number, changes: DailyGoalsUpdate): Promise<DailyGoals> {
    if (Object.keys(changes).length === 0) return this.goalsOf(userId)

    const { userId: _userId, ...goals } = await this.database.db
      .insert(dailyGoals)
      .values({ ...DEFAULT_DAILY_GOALS, ...changes, userId })
      .onConflictDoUpdate({ target: dailyGoals.userId, set: changes })
      .returning()
      .get()
    return goals
  }
}
