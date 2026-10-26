import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common'
import { type DailyGoalsUpdate, dailyGoalsUpdateSchema } from '@open-calorie-tracker/shared'
import { AccessTokenGuard, UserId } from '../../auth/access-token.guard.js'
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js'
import { DailyGoalsService } from './daily-goals.service.js'

// Served under /v1/settings/daily-goals; see SettingsModule.
@Controller()
@UseGuards(AccessTokenGuard)
export class DailyGoalsController {
  constructor(private readonly dailyGoals: DailyGoalsService) {}

  @Get()
  get(@UserId() userId: number) {
    return this.dailyGoals.goalsOf(userId)
  }

  @Patch()
  update(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(dailyGoalsUpdateSchema)) changes: DailyGoalsUpdate,
  ) {
    return this.dailyGoals.update(userId, changes)
  }
}
