import { Body, Controller, Get, Put, Res, UseGuards } from '@nestjs/common'
import { type WeightGoalUpdate, weightGoalUpdateSchema } from '@open-calorie-tracker/shared'
import type { Response } from 'express'
import { AccessTokenGuard, UserId } from '../../auth/access-token.guard.js'
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js'
import { WeightGoalService } from './weight-goal.service.js'

// Served under /v1/settings/weight-goal; see SettingsModule.
@Controller()
@UseGuards(AccessTokenGuard)
export class WeightGoalController {
  constructor(private readonly weightGoal: WeightGoalService) {}

  // Answers the JSON null for a user without a goal, which Nest would send as an empty body.
  @Get()
  async get(@UserId() userId: number, @Res() response: Response) {
    response.json(await this.weightGoal.goalOf(userId))
  }

  @Put()
  save(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(weightGoalUpdateSchema)) goal: WeightGoalUpdate,
  ) {
    return this.weightGoal.save(userId, goal)
  }
}
