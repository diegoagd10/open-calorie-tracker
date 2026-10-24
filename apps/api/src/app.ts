import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module.js'
import { AppConfig } from './config.js'

export const createApp = async (): Promise<NestExpressApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    process.env['NODE_ENV'] === 'test' ? { logger: false } : {},
  )
  app.set('trust proxy', app.get(AppConfig).trustProxy)
  app.enableShutdownHooks()
  return app
}
