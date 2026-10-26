import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common'
import { type ServingSizeInput, servingSizeSchema } from '@open-calorie-tracker/shared'
import type { Response } from 'express'
import { AccessTokenGuard, UserId } from '../auth/access-token.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { ServingSizesService } from './serving-sizes.service.js'

@Controller('v1/serving-sizes')
@UseGuards(AccessTokenGuard)
export class ServingSizesController {
  constructor(private readonly servingSizes: ServingSizesService) {}

  @Get()
  list(@UserId() userId: number) {
    return this.servingSizes.list(userId)
  }

  // 201 with a new serving size, 200 with the one the user already had.
  @Post()
  async create(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(servingSizeSchema)) input: ServingSizeInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { servingSize, created } = await this.servingSizes.findOrCreate(userId, input)
    if (!created) response.status(200)
    return servingSize
  }
}
