import { type SetupStatus } from '@open-calorie-tracker/shared'
import { Controller, Get } from '@nestjs/common'
import { UsersService } from './users.service.js'

@Controller('v1')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('setup')
  async setup(): Promise<SetupStatus> {
    return { needsSetup: !(await this.users.hasAny()) }
  }
}
