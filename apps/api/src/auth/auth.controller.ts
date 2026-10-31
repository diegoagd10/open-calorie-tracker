import {
  type ApiTokenRequest,
  type ApiTokenResponse,
  type LoginInput,
  type LoginResponse,
  type RegisterInput,
  apiTokenRequestSchema,
  loginSchema,
  registerSchema,
} from '@open-calorie-tracker/shared'
import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { ApiKeysService } from '../settings/api-keys/api-keys.service.js'
import { AuthService } from './auth.service.js'

@Controller('v1')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Ip() ip: string) {
    return this.auth.login(body, ip)
  }

  // Registering also logs the new user in, so it answers like a login.
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<LoginResponse> {
    return this.auth.register(body)
  }

  // Where a third-party app exchanges one of the user's API keys for a short-lived access token.
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async token(
    @Body(new ZodValidationPipe(apiTokenRequestSchema)) { apiKey }: ApiTokenRequest,
  ): Promise<ApiTokenResponse> {
    return this.auth.issueApiToken(await this.apiKeys.registerUse(apiKey))
  }
}
