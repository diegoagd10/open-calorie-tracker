import { type LoginInput, loginSchema } from '@open-calorie-tracker/shared'
import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { AuthService } from './auth.service.js'

@Controller('v1')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Ip() ip: string) {
    return this.auth.login(body, ip)
  }
}
