import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { LoginAttemptsService } from './login-attempts.service.js'
import { LoginRateLimitGuard } from './login-rate-limit.guard.js'
import { TokenService } from './token.service.js'

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, LoginAttemptsService, LoginRateLimitGuard, TokenService],
})
export class AuthModule {}
