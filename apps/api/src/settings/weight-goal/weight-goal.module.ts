import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { WeightGoalController } from './weight-goal.controller.js'
import { WeightGoalService } from './weight-goal.service.js'

@Module({
  imports: [AuthModule],
  controllers: [WeightGoalController],
  providers: [WeightGoalService],
  // The weight history measures the weigh-ins against the goal.
  exports: [WeightGoalService],
})
export class WeightGoalModule {}
