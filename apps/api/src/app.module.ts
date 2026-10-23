import { Module } from '@nestjs/common';
import { AppService } from './app.service.js';

@Module({
  providers: [AppService],
})
export class AppModule {}
