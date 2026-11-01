import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  type CreateFoodEntryInput,
  type FoodEntryInput,
  createFoodEntrySchema,
  updateFoodEntrySchema,
} from '@open-calorie-tracker/shared'
import { AccessTokenGuard, RequiresScope, UserId } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { FoodEntriesService } from './food-entries.service.js'

const body = new ZodValidationPipe(updateFoodEntrySchema)

@Controller('v1/food-entries')
@UseGuards(AccessTokenGuard)
@RequiresScope('food-entries:write')
export class FoodEntriesController {
  constructor(private readonly foodEntries: FoodEntriesService) {}

  @Post()
  create(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(createFoodEntrySchema)) input: CreateFoodEntryInput,
  ) {
    return this.foodEntries.create(userId, input)
  }

  @Get(':id')
  @RequiresScope('food-entries:read')
  find(@UserId() userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.foodEntries.find(userId, id)
  }

  @Patch(':id')
  update(
    @UserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(body) input: FoodEntryInput,
  ) {
    return this.foodEntries.update(userId, id, input)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@UserId() userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.foodEntries.remove(userId, id)
  }
}
