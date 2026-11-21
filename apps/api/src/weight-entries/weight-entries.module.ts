import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { WeightGoalModule } from '../settings/weight-goal/weight-goal.module.js'
import { WeightEntriesController } from './weight-entries.controller.js'
import { WeightEntriesService } from './weight-entries.service.js'

@Module({
  imports: [AuthModule, WeightGoalModule],
  controllers: [WeightEntriesController],
  providers: [WeightEntriesService],
  exports: [WeightEntriesService],
})
export class WeightEntriesModule {}
