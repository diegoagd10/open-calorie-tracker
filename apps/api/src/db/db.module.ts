import { Global, Module } from '@nestjs/common'
import { AppConfig } from '../config.js'
import { Database } from './database.js'

@Global()
@Module({
  providers: [
    {
      provide: Database,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => Database.connect(config.databaseUrl),
    },
  ],
  exports: [Database],
})
export class DbModule {}
