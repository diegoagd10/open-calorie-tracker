import type { LoginInput } from '@open-calorie-tracker/shared'
import { post } from './http'

export const login = (input: LoginInput, clientIp: string) => post('/v1/login', input, clientIp)
