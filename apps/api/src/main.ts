import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

@Module({})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  await app.listen(process.env['PORT'] ?? 3001)
}
await bootstrap()
