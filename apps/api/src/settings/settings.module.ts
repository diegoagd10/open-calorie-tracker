import { Module } from '@nestjs/common'
import { RouterModule } from '@nestjs/core'
import { DailyGoalsModule } from './daily-goals/daily-goals.module.js'
import { PasswordModule } from './password/password.module.js'

// What the Settings page manages. Each setting is a submodule served under /v1/settings/<name>.
@Module({
  imports: [
    DailyGoalsModule,
    PasswordModule,
    RouterModule.register([
      {
        path: 'v1/settings',
        children: [
          { path: 'daily-goals', module: DailyGoalsModule },
          { path: 'password', module: PasswordModule },
        ],
      },
    ]),
  ],
})
export class SettingsModule {}
