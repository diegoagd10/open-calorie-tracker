import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { UsersModule } from '../../users/users.module.js'
import { ProfileController } from './profile.controller.js'

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [ProfileController],
})
export class ProfileModule {}
