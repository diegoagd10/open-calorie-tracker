import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module.js'
import { ConfigModule } from './config/config.module.js'
import { DailyLogModule } from './daily-log/daily-log.module.js'
import { DbModule } from './db/db.module.js'

@Module({
  imports: [ConfigModule, DbModule, AuthModule, DailyLogModule],
})
export class AppModule {}
