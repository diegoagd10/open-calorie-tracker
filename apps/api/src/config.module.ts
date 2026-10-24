import { Global, Module } from '@nestjs/common'
import { AppConfig } from './config.js'

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => AppConfig.fromEnv() }],
  exports: [AppConfig],
})
export class ConfigModule {}
