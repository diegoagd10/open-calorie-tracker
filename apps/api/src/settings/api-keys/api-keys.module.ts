import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { AppConfig } from '../../config/config.js'
import { Database } from '../../db/database.js'
import { ApiKeysController } from './api-keys.controller.js'
import { ApiKeysService } from './api-keys.service.js'

@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController],
  providers: [
    {
      provide: ApiKeysService,
      inject: [Database, AppConfig],
      useFactory: (database: Database, config: AppConfig) =>
        new ApiKeysService(database, config.apiKeySecret),
    },
  ],
})
export class ApiKeysModule {}
