import { bearer, send } from './http'

const WEIGHT_GOAL_PATH = '/v1/settings/weight-goal'

export const fetchWeightGoal = (accessToken: string) =>
  send('GET', WEIGHT_GOAL_PATH, { headers: bearer(accessToken) })

export const saveWeightGoal = (body: unknown, accessToken: string) =>
  send('PUT', WEIGHT_GOAL_PATH, { body, headers: bearer(accessToken) })
