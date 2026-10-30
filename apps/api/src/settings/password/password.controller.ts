import { Body, Controller, HttpCode, HttpStatus, Put, UseGuards } from '@nestjs/common'
import { type ChangePasswordInput, changePasswordSchema } from '@open-calorie-tracker/shared'
import { AccessTokenGuard, UserId } from '../../auth/access-token.guard.js'
import { AuthService } from '../../auth/auth.service.js'
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js'

// Served under /v1/settings/password; see SettingsModule.
@Controller()
@UseGuards(AccessTokenGuard)
export class PasswordController {
  constructor(private readonly auth: AuthService) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async change(
    @UserId() userId: number,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(userId, body)
  }
}
