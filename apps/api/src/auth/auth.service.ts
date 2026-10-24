import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common'
import { UsersService } from '../users/users.service.js'
import type { LoginDto } from './login.dto.js'
import { hashPassword, verifyPassword } from './password.js'
import { TokenService } from './token.service.js'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000

type Attempts = { failures: number; lockedUntil: number | undefined }

// Compared against when the username does not exist, so both cases take the same time.
const dummyHash = hashPassword('dummy-password-for-timing')

const accountLocked = () =>
  new HttpException('Account locked after too many failed login attempts', HttpStatus.LOCKED)

@Injectable()
export class AuthService {
  // Failed logins per (IP, username), so an attacker can only lock an account for their own IP.
  private readonly attempts = new Map<string, Attempts>()

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  async login({ username, password }: LoginDto, ip: string): Promise<{ accessToken: string }> {
    const attemptsKey = JSON.stringify([ip, username])
    if (this.isLocked(attemptsKey)) throw accountLocked()

    const user = await this.users.findByUsername(username)
    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash))

    if (user === undefined || !passwordMatches) {
      if (this.recordFailure(attemptsKey)) throw accountLocked()
      throw new UnauthorizedException('Invalid username or password')
    }

    this.attempts.delete(attemptsKey)
    return { accessToken: await this.tokens.issueAccessToken(user.id) }
  }

  private isLocked(attemptsKey: string): boolean {
    const lockedUntil = this.attempts.get(attemptsKey)?.lockedUntil
    if (lockedUntil === undefined) return false
    if (lockedUntil > Date.now()) return true

    this.attempts.delete(attemptsKey)
    return false
  }

  // Returns true when this failure locks the account.
  private recordFailure(attemptsKey: string): boolean {
    const failures = (this.attempts.get(attemptsKey)?.failures ?? 0) + 1
    const locked = failures >= MAX_FAILED_ATTEMPTS
    this.attempts.set(attemptsKey, {
      failures,
      lockedUntil: locked ? Date.now() + LOCK_DURATION_MS : undefined,
    })
    return locked
  }
}
