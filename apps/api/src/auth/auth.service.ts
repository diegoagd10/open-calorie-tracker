import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common'
import { UsersService } from '../users/users.service.js'
import { LoginAttemptsService } from './login-attempts.service.js'
import type { LoginDto } from './login.dto.js'
import { hashPassword, verifyPassword } from './password.js'
import { TokenService } from './token.service.js'

// Compared against when the username does not exist, so both cases take the same time.
const dummyHash = hashPassword('dummy-password-for-timing')

const accountLocked = () =>
  new HttpException('Account locked after too many failed login attempts', HttpStatus.LOCKED)

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly attempts: LoginAttemptsService,
    private readonly tokens: TokenService,
  ) {}

  async login({ username, password }: LoginDto, ip: string): Promise<{ accessToken: string }> {
    if (this.attempts.isLocked(ip, username)) throw accountLocked()

    const user = await this.users.findByUsername(username)
    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash))

    if (user === undefined || !passwordMatches) {
      if (this.attempts.recordFailure(ip, username)) throw accountLocked()
      throw new UnauthorizedException('Invalid username or password')
    }

    this.attempts.reset(ip, username)
    return { accessToken: await this.tokens.issueAccessToken(user.id) }
  }
}
