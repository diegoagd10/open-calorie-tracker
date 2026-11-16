import { Injectable } from '@nestjs/common'
import type { WeightGoal, WeightGoalUpdate } from '@open-calorie-tracker/shared'
import { eq } from 'drizzle-orm'
import { Database } from '../../db/database.js'
import { weightGoals } from '../../db/schema.js'

@Injectable()
export class WeightGoalService {
  constructor(private readonly database: Database) {}

  // Null for a user who never set one.
  async goalOf(userId: number): Promise<WeightGoal | null> {
    const stored = await this.database.db.query.weightGoals.findFirst({
      where: eq(weightGoals.userId, userId),
      columns: { userId: false },
    })
    return stored ?? null
  }

  // The goal starts on the given date when it is new or its starting weight changes; changing only
  // the goal weight keeps the date it started on.
  async save(
    userId: number,
    { startWeight, goalWeight, date }: WeightGoalUpdate,
  ): Promise<WeightGoal> {
    const current = await this.goalOf(userId)
    const startDate =
      current !== null && current.startWeight === startWeight ? current.startDate : date
    const goal = { startWeight, goalWeight, startDate }
    await this.database.db
      .insert(weightGoals)
      .values({ ...goal, userId })
      .onConflictDoUpdate({ target: weightGoals.userId, set: goal })
    return goal
  }
}
