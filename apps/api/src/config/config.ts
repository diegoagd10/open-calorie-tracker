import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  TRUST_PROXY: z.string().optional(),
})

// Express "trust proxy" setting: a hop count, a boolean or a list of trusted addresses.
const parseTrustProxy = (value: string | undefined): boolean | number | string => {
  if (value === undefined || value === 'false') return false
  if (value === 'true') return true
  if (/^\d+$/.test(value)) return Number(value)
  return value
}

export class AppConfig {
  constructor(
    readonly databaseUrl: string,
    readonly jwt: { secret: Uint8Array; issuer: string; audience: string },
    readonly trustProxy: boolean | number | string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = envSchema.parse(env)

    return new AppConfig(
      parsed.DATABASE_URL,
      {
        secret: new TextEncoder().encode(parsed.JWT_SECRET),
        issuer: parsed.JWT_ISSUER,
        audience: parsed.JWT_AUDIENCE,
      },
      parseTrustProxy(parsed.TRUST_PROXY),
    )
  }
}
