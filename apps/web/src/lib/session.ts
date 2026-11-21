import { decodeJwt, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

const ACCESS_TOKEN_COOKIE = 'access_token'

const requiredEnv = (name: string) => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
} as const

export const startSession = async (accessToken: string) => {
  const expiresAt = decodeJwt(accessToken).exp ?? 0
  ;(await cookies()).set(ACCESS_TOKEN_COOKIE, accessToken, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
  })
}

export const endSession = async () => {
  ;(await cookies()).set(ACCESS_TOKEN_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
}

export const sessionToken = async () => (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value

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
