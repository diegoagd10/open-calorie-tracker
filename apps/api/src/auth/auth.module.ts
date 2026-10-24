import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module.js'
import { AccessTokenGuard } from './access-token.guard.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { TokenModule } from './token.module.js'

@Module({
  imports: [UsersModule, TokenModule],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard],
  exports: [TokenModule, AccessTokenGuard],
})
export class AuthModule {}
