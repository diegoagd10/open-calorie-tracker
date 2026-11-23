import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Browser, Locator, Page, Route } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vite-plus/test'
import { Database } from '../../../apps/api/src/db/database.js'
import { seedUser } from '../../../apps/api/src/db/seed.js'
import {
  type TestApp,
  createTestApp,
  signAccessToken,
  userIdOf,
} from '../../../apps/api/test/app.js'
import { type Step, replayPlan } from '../../formal-verification/graph.ts'
import { buildFoodLog, chromium } from './food-log.ts'

const ORIGIN = 'http://localhost:9'
const TIME_ZONE = 'America/New_York'
const PAGES = 8
const SHOWN = { timeout: 3_000, interval: 10 }

const PAGE = `<!doctype html><meta charset="utf-8"><body><div id="root"></div>
  <script type="module" src="/food-log.js"></script></body>`

type Kind = {
  name: string
  url: string
  addButton: string
  fill: (dialog: Locator, press: number) => Promise<void>
  valueOf: (entry: Entry) => number
  shownValue: RegExp
}

type Entry = { id: number; type: string; calories: number; amount: number }

const KINDS: Kind[] = [
  {
    name: 'food',
    url: '/api/food-entries',
    addButton: 'Add food',
    fill: async (dialog, press) => {
      if (press === 1) {
        await dialog.getByLabel('Food', { exact: true }).fill('Oatmeal')
        await dialog.getByRole('combobox', { name: 'Serving size' }).fill('1 cup')
      }
      await dialog.getByLabel('Calories per serving').fill(String(press * 100))
    },
    valueOf: ({ calories }) => calories / 100,
    shownValue: /Oatmeal, (\d)00 kcal/g,
  },
  {
    name: 'water',
    url: '/api/water-entries',
    addButton: 'Add water',
    fill: (dialog, press) => dialog.getByLabel('Amount (fl oz)').fill(String(press)),
    valueOf: ({ amount }) => amount,
    shownValue: /Water, (\d) fl oz/g,
  },
]

const ascending = (a: number, b: number) => a - b

let app: TestApp
let apiUrl: string
let browser: Browser
let script: string

beforeAll(async () => {
  script = await buildFoodLog()
  app = await createTestApp()
  await app.listen(0)
  apiUrl = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser.close()
  await app.close()
})

const newUser = async (username: string) => {
  const database = app.get(Database)
  await seedUser(database, { username, password: 'correct-horse-battery-staple' })
  return signAccessToken({ subject: String(await userIdOf(database, username)) })
}

type ApiRequest = { method: string; path: string; body: string | null }

const callApi = async (token: string, { method, path, body }: ApiRequest) => {
  const response = await fetch(`${apiUrl}/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  })
  return { status: response.status, body: await response.text() }
}

const openFoodLog = async (kind: Kind, page: Page, token: string) => {
  const held: { route: Route; request: ApiRequest }[] = []
  await page.route('**/*', async (route) => {
    const { pathname, search } = new URL(route.request().url())
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: PAGE })
    if (pathname === '/food-log.js') {
      return route.fulfill({ contentType: 'text/javascript', body: script })
    }
    if (!pathname.startsWith('/api/')) return route.fulfill({ status: 404 })
    const request = {
      method: route.request().method(),
      path: pathname.slice('/api'.length) + search,
      body: route.request().postData(),
    }
    if (request.method === 'POST' && pathname === kind.url) {
      held.push({ route, request })
      return undefined
    }
    return route.fulfill({
      contentType: 'application/json',
      ...(await callApi(token, request)),
    })
  })
  await page.goto(ORIGIN)
  await page.getByRole('button', { name: kind.addButton }).click()
  return held
}

const replayPath = async (kind: Kind, page: Page, token: string, path: Step[]) => {
  const held = await openFoodLog(kind, page, token)
  const dialog = page.getByRole('dialog')
  const submit = dialog.locator('button[type=submit]')
  let press = 0
  let answer: Awaited<ReturnType<typeof callApi>> | undefined

  const lastHeld = () => {
    const last = held.at(-1)
    if (last === undefined) throw new Error('No request was sent')
    return last
  }

  const arrive = async (number: number) => {
    const request = held[number - 1]?.request
    if (request === undefined) throw new Error(`Press ${number} sent no request`)
    const answered = await callApi(token, request)
    expect(answered.status).toBe(201)
    if (number === press) answer = answered
  }

  const actions: Record<string, () => Promise<unknown>> = {
    PressAdd: async () => {
      press++
      await kind.fill(dialog, press)
      await submit.click()
      await expect.poll(() => held.length, SHOWN).toBe(press)
    },
    Arrive1: () => arrive(1),
    Arrive2: () => arrive(2),
    AnswerArrives: () => lastHeld().route.fulfill({ contentType: 'application/json', ...answer }),
    AnswerLost: () => lastHeld().route.abort(),
    RequestLost: () => lastHeld().route.abort(),
    RequestLate: () => lastHeld().route.abort(),
    Cancel: () => dialog.getByRole('button', { name: 'Cancel' }).click(),
  }

  const dialogState = () =>
    page.evaluate(() => {
      const open = document.querySelector('dialog')
      if (open === null) return 'closed'
      const buttons = [...open.querySelectorAll('button')]
      if (buttons.find(({ textContent }) => textContent === 'Cancel')?.disabled) return 'sending'
      return open.querySelector('[role=alert]') === null ? 'form' : 'error'
    })

  const rows = async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
    const query = new URLSearchParams({ date, timeZone: TIME_ZONE }).toString()
    const log = await callApi(token, { method: 'GET', path: `/daily-log?${query}`, body: null })
    const { entries } = JSON.parse(log.body) as { entries: Entry[] }
    return entries.sort((a, b) => a.id - b.id).map(kind.valueOf)
  }

  const list = async () => {
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('ul[aria-label=Entries] button')].map((entry) =>
        entry.getAttribute('aria-label'),
      ),
    )
    return [...labels.join('\n').matchAll(kind.shownValue)]
      .map(([, value]) => Number(value))
      .sort(ascending)
  }

  const taken: string[] = []
  for (const { action, state } of path) {
    taken.push(action)
    const act = actions[action]
    if (act === undefined) throw new Error(`The model has an unknown action ${action}`)
    await act()
    const where = `${kind.name}: ${taken.join(', ')}`
    await expect.poll(dialogState, { ...SHOWN, message: where }).toBe(state['dialog'])
    expect(await rows(), where).toEqual(state['rows'])
    if (state['dialog'] === 'closed') {
      const expected = [...(state['list'] as number[])].sort(ascending)
      await expect.poll(list, { ...SHOWN, message: `the page, ${where}` }).toEqual(expected)
    }
  }
}

const graph = process.env['STATE_GRAPH']
if (graph === undefined) throw new Error('Run check.ts, which makes the state graph')
const { paths, steps } = replayPlan(readFileSync(graph, 'utf8'))

it.each(KINDS)('adding $name does what the model says', async (kind) => {
  const queue = [...paths.entries()]
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const [index, path] = next
      const token = await newUser(`${kind.name}${index}`)
      const context = await browser.newContext({ timezoneId: TIME_ZONE, locale: 'en-US' })
      try {
        const page = await context.newPage()
        page.setDefaultTimeout(SHOWN.timeout)
        await replayPath(kind, page, token, path)
      } finally {
        await context.close()
      }
    }
  }
  await Promise.all(Array.from({ length: PAGES }, worker))
  console.log(`Replayed ${steps} steps of adding ${kind.name} on the Food Log and the API`)
})
