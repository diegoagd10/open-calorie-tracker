import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { UsersModule } from '../../users/users.module.js'
import { PasswordController } from './password.controller.js'

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [PasswordController],
})
export class PasswordModule {}
