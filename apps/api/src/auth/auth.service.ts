import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ACCOUNT_LOCK_DURATION_SECONDS,
  type ChangePasswordInput,
  INCORRECT_CURRENT_PASSWORD_MESSAGE,
  type LoginInput,
  type LoginResponse,
  MAX_FAILED_ATTEMPTS,
  type RegisterInput,
} from '@open-calorie-tracker/shared'
import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'node:crypto'
import { AppConfig } from '../config/config.js'
import { UsersService, normalizeUsername } from '../users/users.service.js'
import { hashPassword, verifyPassword } from './password.js'

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
    private readonly config: AppConfig,
  ) {}

  async login({ username, password }: LoginInput, ip: string): Promise<LoginResponse> {
    const attemptsKey = JSON.stringify([ip, normalizeUsername(username)])
    if (this.isLocked(attemptsKey)) throw accountLocked()

    const user = await this.users.findByUsername(username)
    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash))

    if (user === undefined || !passwordMatches) {
      if (this.recordFailure(attemptsKey)) throw accountLocked()
      throw new UnauthorizedException('Invalid username or password')
    }

    this.attempts.delete(attemptsKey)
    return { accessToken: await this.issueAccessToken(user.id) }
  }

  // Registering also logs the new user in.
  async register(input: RegisterInput): Promise<LoginResponse> {
    const userId = await this.users.register(input)
    return { accessToken: await this.issueAccessToken(userId) }
  }

  // Replaces the user's password once the current one proves it is them. Tokens already issued,
  // including the one making this request, stay valid until they expire.
  async changePassword(
    userId: number,
    { currentPassword, newPassword }: ChangePasswordInput,
  ): Promise<void> {
    const user = await this.users.findById(userId)
    if (user === undefined || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ForbiddenException(INCORRECT_CURRENT_PASSWORD_MESSAGE)
    }

    await this.users.setPassword(userId, newPassword)
  }

  // Returns the user id of a valid, unexpired token signed by this API, or undefined.
  async verifyAccessToken(token: string): Promise<number | undefined> {
    const { secret, issuer, audience } = this.config.jwt
    try {
      const { payload } = await jwtVerify(token, secret, {
        issuer,
        audience,
        algorithms: ['HS256'],
      })
      return Number(payload.sub)
    } catch {
      return undefined
    }
  }

  private issueAccessToken(userId: number): Promise<string> {
    const { secret, issuer, audience } = this.config.jwt
    const issuedAt = Math.floor(Date.now() / 1000)

    return new SignJWT()
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(String(userId))
      .setJti(randomUUID())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(secret)
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
      lockedUntil: locked ? Date.now() + ACCOUNT_LOCK_DURATION_SECONDS * 1000 : undefined,
    })
    return locked
  }
}
