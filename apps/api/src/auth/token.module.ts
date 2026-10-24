import { Module } from '@nestjs/common'
import { TokenService } from './token.service.js'

// Its own module so both logging in and registering can issue access tokens.
@Module({
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}
