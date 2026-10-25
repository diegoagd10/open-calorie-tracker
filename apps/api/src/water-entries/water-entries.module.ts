import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { WaterEntriesController } from './water-entries.controller.js'
import { WaterEntriesService } from './water-entries.service.js'

@Module({
  imports: [AuthModule],
  controllers: [WaterEntriesController],
  providers: [WaterEntriesService],
})
export class WaterEntriesModule {}
