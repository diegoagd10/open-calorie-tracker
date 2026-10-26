import { Module } from '@nestjs/common'
import { RouterModule } from '@nestjs/core'
import { DailyGoalsModule } from './daily-goals/daily-goals.module.js'

// What the Settings page manages. Each setting is a submodule served under /v1/settings/<name>.
@Module({
  imports: [
    DailyGoalsModule,
    RouterModule.register([
      { path: 'v1/settings', children: [{ path: 'daily-goals', module: DailyGoalsModule }] },
    ]),
  ],
})
export class SettingsModule {}
