import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { DailyGoalsModule } from '../settings/daily-goals/daily-goals.module.js'
import { DailyLogController } from './daily-log.controller.js'
import { DailyLogService } from './daily-log.service.js'

@Module({
  imports: [AuthModule, DailyGoalsModule],
  controllers: [DailyLogController],
  providers: [DailyLogService],
})
export class DailyLogModule {}
