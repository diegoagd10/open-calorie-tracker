import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module.js'
import { PasswordController } from './password.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [PasswordController],
})
export class PasswordModule {}
