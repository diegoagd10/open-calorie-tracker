import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ServingSizesController } from './serving-sizes.controller.js'
import { ServingSizesService } from './serving-sizes.service.js'

@Module({
  imports: [AuthModule],
  controllers: [ServingSizesController],
  providers: [ServingSizesService],
  // Food entries point to the user's serving sizes, and the MCP server lists and creates them.
  exports: [ServingSizesService],
})
export class ServingSizesModule {}
