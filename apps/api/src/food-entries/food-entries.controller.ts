import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { type FoodEntryInput, foodEntrySchema } from '@open-calorie-tracker/shared'
import { AccessTokenGuard, UserId } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { FoodEntriesService } from './food-entries.service.js'

@Controller('v1/food-entries')
@UseGuards(AccessTokenGuard)
export class FoodEntriesController {
  constructor(private readonly foodEntries: FoodEntriesService) {}

  @Post()
  create(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(foodEntrySchema)) input: FoodEntryInput,
  ) {
    return this.foodEntries.create(userId, input)
  }
}
