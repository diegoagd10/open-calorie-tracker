import { jwtVerify } from 'jose'

export const ACCESS_TOKEN_COOKIE = 'access_token'

const jwtConfig = () => {
  const { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } = process.env
  if (!JWT_SECRET || !JWT_ISSUER || !JWT_AUDIENCE) {
    throw new Error('JWT_SECRET, JWT_ISSUER and JWT_AUDIENCE must be set to check sessions')
  }
  return {
    secret: new TextEncoder().encode(JWT_SECRET),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }
}

// True for an unexpired access token signed by the API. The API still checks it on every call.
export const isValidAccessToken = async (token: string): Promise<boolean> => {
  const { secret, issuer, audience } = jwtConfig()
  try {
    await jwtVerify(token, secret, { issuer, audience, algorithms: ['HS256'] })
    return true
  } catch {
    return false
  }
}
