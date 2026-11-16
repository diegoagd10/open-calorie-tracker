import type { Page } from 'playwright'
import { expect } from 'vite-plus/test'
import { TIME_ZONE, eventually } from './browser'
import { SEEDED } from './fixtures'

const { proxyUrl: PROXY_URL, webUrl: WEB_URL } = SEEDED

export const WEIGHT_URL = `${WEB_URL}/weight`

export type WeightHistory = {
  entries: { date: string; weight: number; trend: number }[]
  goal: { startWeight: number; goalWeight: number; startDate: string } | null
}

export type WeightGoal = { startWeight: number; goalWeight: number; startDate: string }

// The API's clock cannot be fixed from here, so weights are seeded on days counted back from the
// real today in the time zone.
export const dateIn = (daysAgo = 0, timeZone = TIME_ZONE) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
  const [year = 0, month = 0, day = 0] = today.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - daysAgo)).toISOString().slice(0, 10)
}

// How the Weight page shows a date, e.g. "Oct 23".
export const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )

// Calls the API through the fault proxy with the user's token, for states the test sets up or
// checks behind the page's back.
const callApi = async (token: string, method: string, path: string, body?: object) => {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await fetch(`${PROXY_URL}${path}`, init)
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`)
  return response.json() as Promise<unknown>
}

export const logWeight = (token: string, weight: number, date: string) =>
  callApi(token, 'POST', '/v1/weight-entries', { weight, date, timeZone: TIME_ZONE })

export const saveWeightGoal = (
  token: string,
  startWeight: number,
  goalWeight: number,
  date = dateIn(),
) => callApi(token, 'PUT', '/v1/settings/weight-goal', { startWeight, goalWeight, date })

export const weightHistory = async (token: string) =>
  (await callApi(token, 'GET', '/v1/weight-history')) as WeightHistory

export const weightGoal = async (token: string) =>
  (await callApi(token, 'GET', '/v1/settings/weight-goal')) as WeightGoal | null

export const weightPage = (page: Page) => {
  const main = page.getByRole('main')
  const chart = main.getByRole('img', { name: 'Weight chart' })
  return {
    title: () => page.getByRole('heading', { level: 1, name: 'Weight' }),
    field: () => main.getByRole('textbox', { name: "Today's weight" }),
    save: () =>
      main.getByRole('form', { name: "Today's weight" }).getByRole('button', { name: 'Save' }),
    savedToday: () => main.getByText('Saved today'),
    lastWeighIn: (date: string) => main.getByText(`Last weigh-in: ${shortDate(date)}`),
    rangeError: () => main.getByText('Enter a weight from 50 to 999 lb'),
    tile: (name: 'Current' | 'Lost' | 'To go' | 'Progress') =>
      main.getByRole('group', { name, exact: true }),
    noWeighIns: () => main.getByText('No weigh-ins yet'),
    chartStartsTomorrow: () => main.getByText('Your chart starts tomorrow'),
    chart: () => chart,
    points: () => chart.locator('[data-point]'),
    point: (date: string) => chart.locator(`[data-point][data-date="${date}"]`),
    line: (kind: 'trend' | 'goal' | 'start') => chart.locator(`[data-line="${kind}"]`),
    axisStart: () => chart.locator('[data-axis="start"]'),
    axisEnd: () => chart.locator('[data-axis="end"]'),
    period: (name: '30D' | '90D' | '1Y' | 'All') =>
      main.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name }),
    noGoalNotice: () =>
      main.getByText('Set your starting and goal weight in Settings to see your progress.'),
    noGoalSettingsLink: () => main.getByRole('link', { name: 'Settings' }),
    goalReached: () => main.getByText('Goal reached'),
    // The page's Alert, scoped to <main> because Next.js renders its own role="alert" route announcer.
    alert: () => main.getByRole('alert'),
    // canvas-confetti draws on a canvas it adds to the body.
    confetti: () => page.locator('body > canvas'),
  }
}

export const openWeight = async (page: Page) => {
  await page.goto(WEIGHT_URL)
  await expect.poll(() => weightPage(page).title().isVisible(), eventually).toBe(true)
}
