import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { DailyLogController } from './daily-log.controller.js'
import { DailyLogService } from './daily-log.service.js'

@Module({
  imports: [AuthModule],
  controllers: [DailyLogController],
  providers: [DailyLogService],
})
export class DailyLogModule {}
