import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module.js'
import { AccessTokenGuard } from './access-token.guard.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { TokenService } from './token.service.js'

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, AccessTokenGuard],
  exports: [TokenService, AccessTokenGuard],
})
export class AuthModule {}
