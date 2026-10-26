import { bearer, send } from './http'

const DAILY_GOALS_PATH = '/v1/settings/daily-goals'

export const fetchDailyGoals = (accessToken: string) =>
  send('GET', DAILY_GOALS_PATH, { headers: bearer(accessToken) })

export const updateDailyGoals = (body: unknown, accessToken: string) =>
  send('PATCH', DAILY_GOALS_PATH, { body, headers: bearer(accessToken) })
