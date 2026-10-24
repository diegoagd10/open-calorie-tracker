import { Injectable } from '@nestjs/common'
import { ACCESS_TOKEN_TTL_SECONDS } from '@open-calorie-tracker/shared'
import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'node:crypto'
import { AppConfig } from '../config/config.js'

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
}
