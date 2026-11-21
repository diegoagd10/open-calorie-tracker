import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common'
import { AccessTokenGuard, RequiresScope, UserId } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import {
  type LogWeightInput,
  type WeightHistoryQuery,
  WeightEntriesService,
  logWeightSchema,
  weightHistoryQuerySchema,
} from './weight-entries.service.js'

@Controller('v1')
@UseGuards(AccessTokenGuard)
export class WeightEntriesController {
  constructor(private readonly weightEntries: WeightEntriesService) {}

  @Post('weight-entries')
  @HttpCode(200)
  @RequiresScope('weight-entries:write')
  log(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(logWeightSchema)) input: LogWeightInput,
  ) {
    return this.weightEntries.log(userId, input)
  }

  @Get('weight-history')
  @RequiresScope('weight-entries:read')
  history(
    @UserId() userId: number,
    @Query(new ZodValidationPipe(weightHistoryQuerySchema)) query: WeightHistoryQuery,
  ) {
    return this.weightEntries.history(userId, query)
  }
}
