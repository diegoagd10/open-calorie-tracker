import { Controller, Get, UseGuards } from '@nestjs/common'
import type { Profile } from '@open-calorie-tracker/shared'
import { AccessTokenGuard, UserId } from '../../auth/access-token.guard.js'
import { UsersService } from '../../users/users.service.js'

// Served under /v1/settings/profile; see SettingsModule.
@Controller()
@UseGuards(AccessTokenGuard)
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get(@UserId() userId: number): Promise<Profile> {
    return this.users.profileOf(userId)
  }
}
