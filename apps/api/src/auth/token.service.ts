import { Injectable } from '@nestjs/common'
import { SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
import { AppConfig } from '../config/config.js'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfig) {}

  issueAccessToken(userId: number): Promise<string> {
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
}
