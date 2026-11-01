import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AccessTokenGuard, RequiresScope, UserId } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { DailyLogService } from './daily-log.service.js'
import { type DayQuery, type RangeQuery, dayQuerySchema, rangeQuerySchema } from './day.js'

@Controller('v1')
@UseGuards(AccessTokenGuard)
export class DailyLogController {
  constructor(private readonly dailyLog: DailyLogService) {}

  // The entries, totals and goals of one calendar day in the user's time zone.
  @Get('daily-log')
  @RequiresScope('daily-log:read')
  get(@UserId() userId: number, @Query(new ZodValidationPipe(dayQuerySchema)) day: DayQuery) {
    return this.dailyLog.dailyLog(userId, day)
  }

  // Each day's calories and number of food entries from one calendar day to another.
  @Get('daily-summaries')
  @RequiresScope('daily-log:read')
  summaries(
    @UserId() userId: number,
    @Query(new ZodValidationPipe(rangeQuerySchema)) range: RangeQuery,
  ) {
    return this.dailyLog.dailySummaries(userId, range)
  }
}
