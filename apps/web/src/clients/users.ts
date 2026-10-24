import { type RegisterInput, setupStatusSchema } from '@open-calorie-tracker/shared'
import { get, post } from './http'

// Whether the app still has no account. Undefined when the API cannot tell.
export const fetchNeedsSetup = async (): Promise<boolean | undefined> => {
  try {
    const response = await get('/v1/setup')
    if (!response.ok) return undefined
    const body = setupStatusSchema.safeParse(await response.json())
    return body.success ? body.data.needsSetup : undefined
  } catch {
    return undefined
  }
}

export const register = (input: RegisterInput, clientIp: string) =>
  post('/v1/register', input, clientIp)
