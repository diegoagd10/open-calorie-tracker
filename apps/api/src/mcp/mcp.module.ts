import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { DailyLogModule } from '../daily-log/daily-log.module.js'
import { FoodEntriesModule } from '../food-entries/food-entries.module.js'
import { ProductsModule } from '../products/products.module.js'
import { ServingSizesModule } from '../serving-sizes/serving-sizes.module.js'
import { ApiKeysModule } from '../settings/api-keys/api-keys.module.js'
import { WaterEntriesModule } from '../water-entries/water-entries.module.js'
import { McpController } from './mcp.controller.js'
import { McpService } from './mcp.service.js'

@Module({
  imports: [
    AuthModule,
    ApiKeysModule,
    DailyLogModule,
    FoodEntriesModule,
    WaterEntriesModule,
    ServingSizesModule,
    ProductsModule,
  ],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
