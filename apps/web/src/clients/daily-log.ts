import { get } from './http'

export const fetchDailyLog = (day: { date: string; timeZone: string }, accessToken: string) =>
  get(`/v1/daily-log?${new URLSearchParams(day)}`, { Authorization: `Bearer ${accessToken}` })
