import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ServingSizesModule } from '../serving-sizes/serving-sizes.module.js'
import { FoodEntriesController } from './food-entries.controller.js'
import { FoodEntriesService } from './food-entries.service.js'

@Module({
  imports: [AuthModule, ServingSizesModule],
  controllers: [FoodEntriesController],
  providers: [FoodEntriesService],
  // The MCP server logs food.
  exports: [FoodEntriesService],
})
export class FoodEntriesModule {}
