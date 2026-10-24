import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module.js'
import { ConfigModule } from './config.module.js'
import { DbModule } from './db/db.module.js'

@Module({
  imports: [ConfigModule, DbModule, AuthModule],
})
export class AppModule {}
