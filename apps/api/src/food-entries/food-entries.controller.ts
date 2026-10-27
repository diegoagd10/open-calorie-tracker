import { Body, Controller, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { type FoodEntryInput, foodEntrySchema } from '@open-calorie-tracker/shared'
import { AccessTokenGuard, UserId } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { FoodEntriesService } from './food-entries.service.js'

const body = new ZodValidationPipe(foodEntrySchema)

@Controller('v1/food-entries')
@UseGuards(AccessTokenGuard)
export class FoodEntriesController {
  constructor(private readonly foodEntries: FoodEntriesService) {}

  @Post()
  create(@UserId() userId: number, @Body(body) input: FoodEntryInput) {
    return this.foodEntries.create(userId, input)
  }

  @Patch(':id')
  update(
    @UserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(body) input: FoodEntryInput,
  ) {
    return this.foodEntries.update(userId, id, input)
  }
}
