import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { DailyGoalsController } from './daily-goals.controller.js'
import { DailyGoalsService } from './daily-goals.service.js'

@Module({
  imports: [AuthModule],
  controllers: [DailyGoalsController],
  providers: [DailyGoalsService],
  // The daily log measures each day against these goals.
  exports: [DailyGoalsService],
})
export class DailyGoalsModule {}
