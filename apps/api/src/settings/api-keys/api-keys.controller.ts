import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { type ApiKeyCreateInput, apiKeyCreateSchema } from '@open-calorie-tracker/shared'
import { AccessTokenGuard, UserId } from '../../auth/access-token.guard.js'
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js'
import { ApiKeysService } from './api-keys.service.js'

// Served under /v1/settings/api-keys; see SettingsModule.
@Controller()
@UseGuards(AccessTokenGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@UserId() userId: number) {
    return this.apiKeys.list(userId)
  }

  @Post()
  create(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(apiKeyCreateSchema)) input: ApiKeyCreateInput,
  ) {
    return this.apiKeys.create(userId, input)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@UserId() userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.apiKeys.remove(userId, id)
  }
}
