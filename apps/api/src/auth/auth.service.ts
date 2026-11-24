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
  API_ACCESS_TOKEN_TTL_SECONDS,
  API_SCOPES,
  type ApiScope,
  type ApiTokenResponse,
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
import type { User } from '../db/schema.js'
import { UsersService, normalizeUsername } from '../users/users.service.js'
import { hashPassword, verifyPassword } from './password.js'

type Attempts = { failures: number; checking: number; lockedUntil: number | undefined }

export type TokenSubject = { userId: number; scopes: string[] | undefined }

const dummyHash = hashPassword('dummy-password-for-timing')

const accountLocked = () =>
  new HttpException('Account locked after too many failed login attempts', HttpStatus.LOCKED)

const tooManyAttempts = () =>
  new HttpException('Too many login attempts at once', HttpStatus.TOO_MANY_REQUESTS)

const recordFailure = (attempts: Attempts): boolean => {
  attempts.failures++
  const locked = attempts.failures >= MAX_FAILED_ATTEMPTS
  if (locked) attempts.lockedUntil = Date.now() + ACCOUNT_LOCK_DURATION_SECONDS * 1000
  return locked
}

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, Attempts>()

  constructor(
    private readonly users: UsersService,
    private readonly config: AppConfig,
  ) {}

  async login({ username, password }: LoginInput, ip: string): Promise<LoginResponse> {
    const attemptsKey = JSON.stringify([ip, normalizeUsername(username)])
    const attempts = this.reserveCheck(attemptsKey)

    let user: User | undefined
    try {
      user = await this.users.findByUsername(username)
      const passwordHash = user?.passwordHash ?? (await dummyHash)
      if (!(await verifyPassword(password, passwordHash))) user = undefined
    } finally {
      attempts.checking--
    }

    if (user === undefined) {
      if (recordFailure(attempts)) throw accountLocked()
      throw new UnauthorizedException('Invalid username or password')
    }

    attempts.failures = 0
    if (attempts.checking === 0) this.attempts.delete(attemptsKey)
    return { accessToken: await this.issueAccessToken(user.id) }
  }

  async register(input: RegisterInput): Promise<LoginResponse> {
    const userId = await this.users.register(input)
    return { accessToken: await this.issueAccessToken(userId) }
  }

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

  async issueApiToken(userId: number): Promise<ApiTokenResponse> {
    const scopes = [...API_SCOPES]
    return {
      accessToken: await this.issueAccessToken(userId, scopes),
      tokenType: 'Bearer',
      expiresIn: API_ACCESS_TOKEN_TTL_SECONDS,
      scopes,
    }
  }

  async verifyAccessToken(token: string): Promise<TokenSubject | undefined> {
    const { secret, issuer, audience } = this.config.jwt
    try {
      const { payload } = await jwtVerify(token, secret, {
        issuer,
        audience,
        algorithms: ['HS256'],
      })
      const { scope } = payload
      return {
        userId: Number(payload.sub),
        scopes: typeof scope === 'string' ? scope.split(' ') : undefined,
      }
    } catch {
      return undefined
    }
  }

  private issueAccessToken(userId: number, scopes?: ApiScope[]): Promise<string> {
    const { secret, issuer, audience } = this.config.jwt
    const issuedAt = Math.floor(Date.now() / 1000)
    const ttl = scopes === undefined ? ACCESS_TOKEN_TTL_SECONDS : API_ACCESS_TOKEN_TTL_SECONDS

    return new SignJWT(scopes === undefined ? {} : { scope: scopes.join(' ') })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(String(userId))
      .setJti(randomUUID())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttl)
      .sign(secret)
  }

  private reserveCheck(attemptsKey: string): Attempts {
    const attempts = this.currentAttempts(attemptsKey)
    if (attempts.lockedUntil !== undefined) throw accountLocked()
    if (attempts.failures >= MAX_FAILED_ATTEMPTS) throw tooManyAttempts()

    attempts.checking++
    this.attempts.set(attemptsKey, attempts)
    return attempts
  }

  private currentAttempts(attemptsKey: string): Attempts {
    const attempts = this.attempts.get(attemptsKey)
    const lockExpired = attempts?.lockedUntil !== undefined && attempts.lockedUntil <= Date.now()
    return attempts === undefined || lockExpired
      ? { failures: 0, checking: 0, lockedUntil: undefined }
      : attempts
  }
}
