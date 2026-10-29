import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  type CreateWaterEntryInput,
  type WaterEntryInput,
  createWaterEntrySchema,
  waterEntrySchema,
} from '@open-calorie-tracker/shared'
import { AccessTokenGuard, UserId } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { WaterEntriesService } from './water-entries.service.js'

const body = new ZodValidationPipe(waterEntrySchema)

@Controller('v1/water-entries')
@UseGuards(AccessTokenGuard)
export class WaterEntriesController {
  constructor(private readonly waterEntries: WaterEntriesService) {}

  @Post()
  create(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(createWaterEntrySchema)) input: CreateWaterEntryInput,
  ) {
    return this.waterEntries.create(userId, input)
  }

  @Patch(':id')
  update(
    @UserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body(body) input: WaterEntryInput,
  ) {
    return this.waterEntries.update(userId, id, input)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@UserId() userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.waterEntries.remove(userId, id)
  }
}
