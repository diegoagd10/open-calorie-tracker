import { bearer, get } from './http'

export const fetchDailySummaries = (
  range: { from: string; to: string; timeZone: string },
  accessToken: string,
) => get(`/v1/daily-summaries?${new URLSearchParams(range)}`, bearer(accessToken))
