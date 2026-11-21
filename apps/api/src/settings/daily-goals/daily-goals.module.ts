import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { DailyGoalsController } from './daily-goals.controller.js'
import { DailyGoalsService } from './daily-goals.service.js'

@Module({
  imports: [AuthModule],
  controllers: [DailyGoalsController],
  providers: [DailyGoalsService],
  exports: [DailyGoalsService],
})
export class DailyGoalsModule {}
