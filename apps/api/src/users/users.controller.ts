import {
  type LoginResponse,
  type RegisterInput,
  type SetupStatus,
  registerSchema,
} from '@open-calorie-tracker/shared'
import { Body, Controller, Get, Post } from '@nestjs/common'
import { TokenService } from '../auth/token.service.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { UsersService } from './users.service.js'

@Controller('v1')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Get('setup')
  async setup(): Promise<SetupStatus> {
    return { needsSetup: !(await this.users.hasAny()) }
  }

  // Registering also logs the new user in, so it answers like a login.
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<LoginResponse> {
    const userId = await this.users.register(body)
    return { accessToken: await this.tokens.issueAccessToken(userId) }
  }
}
