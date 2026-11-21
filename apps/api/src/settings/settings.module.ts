import { Module } from '@nestjs/common'
import { RouterModule } from '@nestjs/core'
import { ApiKeysModule } from './api-keys/api-keys.module.js'
import { DailyGoalsModule } from './daily-goals/daily-goals.module.js'
import { PasswordModule } from './password/password.module.js'
import { ProfileModule } from './profile/profile.module.js'
import { WeightGoalModule } from './weight-goal/weight-goal.module.js'

@Module({
  imports: [
    ProfileModule,
    DailyGoalsModule,
    WeightGoalModule,
    PasswordModule,
    ApiKeysModule,
    RouterModule.register([
      {
        path: 'v1/settings',
        children: [
          { path: 'profile', module: ProfileModule },
          { path: 'daily-goals', module: DailyGoalsModule },
          { path: 'weight-goal', module: WeightGoalModule },
          { path: 'password', module: PasswordModule },
          { path: 'api-keys', module: ApiKeysModule },
        ],
      },
    ]),
  ],
})
export class SettingsModule {}
