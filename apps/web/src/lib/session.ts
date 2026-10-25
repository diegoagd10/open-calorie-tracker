import { decodeJwt, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

const ACCESS_TOKEN_COOKIE = 'access_token'

const requiredEnv = (name: string) => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

// A cookie scripts cannot read, sent only by this site.
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
} as const

// Stores the token the API signed in the session cookie, expiring with the token.
export const startSession = async (accessToken: string) => {
  const expiresAt = decodeJwt(accessToken).exp ?? 0
  ;(await cookies()).set(ACCESS_TOKEN_COOKIE, accessToken, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
  })
}

// Deletes the session cookie. The token itself stays valid at the API until it expires.
export const endSession = async () => {
  ;(await cookies()).set(ACCESS_TOKEN_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
}

// The token the API signed, to authenticate calls made on the user's behalf.
export const sessionToken = async () => (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value

// Checks the token the API signed, with the same secret, issuer and audience it uses.
export const hasValidSession = async (request: NextRequest): Promise<boolean> => {
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  if (token === undefined) return false
  try {
    await jwtVerify(token, new TextEncoder().encode(requiredEnv('JWT_SECRET')), {
      algorithms: ['HS256'],
      issuer: requiredEnv('JWT_ISSUER'),
      audience: requiredEnv('JWT_AUDIENCE'),
    })
    return true
  } catch {
    return false
  }
}
