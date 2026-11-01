import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module.js'
import { ConfigModule } from './config/config.module.js'
import { DailyLogModule } from './daily-log/daily-log.module.js'
import { DbModule } from './db/db.module.js'
import { FoodEntriesModule } from './food-entries/food-entries.module.js'
import { HealthModule } from './health/health.module.js'
import { McpModule } from './mcp/mcp.module.js'
import { ProductsModule } from './products/products.module.js'
import { ServingSizesModule } from './serving-sizes/serving-sizes.module.js'
import { SettingsModule } from './settings/settings.module.js'
import { WaterEntriesModule } from './water-entries/water-entries.module.js'

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    DailyLogModule,
    WaterEntriesModule,
    ServingSizesModule,
    FoodEntriesModule,
    ProductsModule,
    SettingsModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
