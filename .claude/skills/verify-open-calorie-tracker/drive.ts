import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type * as Playwright from 'playwright'
import type { Browser, Locator, Page } from 'playwright'
import { MOBILE } from '../../../apps/web/test/browser.ts'
import { Failure, readState } from './model.ts'
import type { Instance, Method, State, Target } from './model.ts'

const ACTION_TIMEOUT_MS = 5_000
const QUIET_MS = 500
const SETTLE_TIMEOUT_MS = 10_000
const MAX_CANDIDATES = 15
const DESKTOP = { width: 1280, height: 720 }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const playwright = (repo: string): typeof Playwright => {
  const requireFromWeb: (id: 'playwright') => typeof Playwright = createRequire(
    join(repo, 'apps/web/package.json'),
  )
  return requireFromWeb('playwright')
}

const liveState = async (instance: Instance, repo: string): Promise<State> => {
  const state = await readState(instance)
  if (state === undefined) {
    throw new Failure(
      `no instance runs for ${instance.urls.web}`,
      `Run up --url ${instance.urls.web}, or up --docker --url ${instance.urls.web}`,
    )
  }
  if (state.repo !== repo) {
    throw new Failure(
      `${instance.urls.web} runs ${state.repo}, not this checkout`,
      `Drive it from ${state.repo}, or run up here with another --url`,
    )
  }
  return state
}

// oxlint-disable-next-line local/no-comments
// Headless Chromium draws no browser UI but still takes its height out of --window-size, so the
// contents get sized instead.
const withPage = async <T>(
  instance: Instance,
  repo: string,
  act: (page: Page, state: State) => Promise<T>,
): Promise<T> => {
  const state = await liveState(instance, repo)
  let browser: Browser
  try {
    browser = await playwright(repo).chromium.connectOverCDP(state.cdpUrl, {
      timeout: ACTION_TIMEOUT_MS,
    })
  } catch (error) {
    throw new Failure(
      `cannot attach to Chromium at ${state.cdpUrl}: ${messageOf(error).split('\n')[0]}`,
      `Run doctor --url ${state.webUrl}`,
    )
  }
  try {
    const [context] = browser.contexts()
    if (context === undefined) throw new Error('Chromium has no default context')
    const page = context.pages()[0] ?? (await context.newPage())
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    const cdp = await context.newCDPSession(page)
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    await cdp.send('Browser.setContentsSize', { windowId, ...DESKTOP })
    await cdp.detach()
    return await act(page, state)
  } finally {
    await browser.close()
  }
}

const settled = async (page: Page, action: () => Promise<unknown>): Promise<boolean> => {
  let inFlight = 0
  let quietSince = Date.now()
  const started = () => {
    inFlight += 1
  }
  const ended = () => {
    inFlight -= 1
    quietSince = Date.now()
  }
  page.on('request', started)
  page.on('requestfinished', ended)
  page.on('requestfailed', ended)
  try {
    await action()
    const deadline = Date.now() + SETTLE_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (inFlight <= 0 && Date.now() - quietSince >= QUIET_MS) return true
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  } finally {
    page.off('request', started)
    page.off('requestfinished', ended)
    page.off('requestfailed', ended)
  }
}

const where = async (page: Page) => ({ url: page.url(), title: await page.title() })

const sessionToken = async (page: Page, state: State): Promise<string | undefined> =>
  (await page.context().cookies(state.webUrl)).find((cookie) => cookie.name === 'access_token')
    ?.value

const noSession = (state: State) =>
  new Failure(
    'the browser has no session',
    `Run login --url ${state.webUrl}, as the seed user or with --username and --password`,
  )

// oxlint-disable-next-line local/no-comments
// Playwright's errors carry a call log after the first line.
const actionFailure = (error: unknown, state: State): Failure =>
  error instanceof Failure
    ? error
    : new Failure(
        messageOf(error).split('\n')[0] ?? 'the action failed',
        `Run snapshot --url ${state.webUrl} to see the page`,
      )

const describe = async (locator: Locator): Promise<string> =>
  (await locator.ariaSnapshot()).split('\n')[0]?.replace(/^- /, '').replace(/:$/, '') ?? ''

const scope = async (page: Page): Promise<{ root: Locator; dialog: string | undefined }> => {
  const modals = page.locator(':modal')
  if ((await modals.count()) === 0) return { root: page.locator('body'), dialog: undefined }
  const root = modals.last()
  return { root, dialog: await describe(root) }
}

const nodes = async (root: Locator): Promise<{ role: string; line: string; name: string }[]> =>
  (await root.ariaSnapshot()).split('\n').flatMap((raw) => {
    const match = /^\s*- (\w+)(?: "((?:[^"\\]|\\.)*)")?/.exec(raw)
    if (match?.[1] === undefined) return []
    const line = raw.trim().replace(/^- /, '').replace(/:$/, '')
    return [{ role: match[1], line, name: match[2] ?? '' }]
  })

const find = async (page: Page, { role, name, nth }: Target): Promise<Locator> => {
  const { root, dialog } = await scope(page)
  const exact = root.getByRole(role, { name, exact: true })
  const loose = root.getByRole(role, { name })
  const matches = (await exact.count()) > 0 ? exact : loose
  const count = await matches.count()
  if (nth === undefined ? count === 1 : nth < count) return matches.nth(nth ?? 0)
  const label = `${role} "${name}"`
  if (count > 0) {
    const all = await matches.all()
    throw new Failure(
      nth === undefined
        ? `${count} elements match ${label}`
        : `--nth ${nth} is out of range: ${count} elements match ${label}`,
      'Pass the full name of one candidate, or --nth I for the I-th candidate, from 0. A name matches by substring only when no name is exact',
      { candidates: await Promise.all(all.slice(0, MAX_CANDIDATES).map(describe)) },
    )
  }
  const lower = name.toLowerCase()
  const nearby = (await nodes(root))
    .filter(
      (node) => node.role === role || (lower !== '' && node.name.toLowerCase().includes(lower)),
    )
    .map((node) => node.line)
  if (dialog !== undefined) {
    throw new Failure(
      `no ${label} in the open ${dialog}`,
      'The page behind an open dialog cannot be used. Pick a candidate, or close the dialog first',
      { candidates: nearby.slice(0, MAX_CANDIDATES) },
    )
  }
  throw new Failure(
    `no ${label} on ${page.url()}`,
    nearby.length > 0
      ? 'Pick one of the candidates, by its role and name'
      : `Run snapshot: the page has no ${role} and no name containing "${name}"`,
    { candidates: nearby.slice(0, MAX_CANDIDATES) },
  )
}

export const login = (
  instance: Instance,
  repo: string,
  credentials: { username: string | undefined; password: string | undefined },
) =>
  withPage(instance, repo, async (page, state) => {
    const username = credentials.username ?? state.seedUser.username
    const password = credentials.password ?? state.seedUser.password
    await page.context().clearCookies()
    await settled(page, () => page.goto(`${state.webUrl}/login`))
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill(password)
    const alert = page.getByRole('form', { name: 'Log in' }).getByRole('alert')
    const ok = await settled(page, () => page.getByRole('button', { name: 'Log in' }).click())
    if (new URL(page.url()).pathname !== '/') {
      const reason =
        (await alert.count()) > 0 ? await alert.textContent() : `ended on ${page.url()}`
      throw new Failure(
        `login as ${username} failed: ${reason}`,
        `The seed user is ${state.seedUser.username} / ${state.seedUser.password}; run doctor if it is right`,
      )
    }
    return { ok: true, username, settled: ok, ...(await where(page)) }
  })

export const goto = (instance: Instance, repo: string, path: string) =>
  withPage(instance, repo, async (page, state) => {
    const ok = await settled(page, () => page.goto(new URL(path, state.webUrl).href))
    const landed = new URL(page.url()).pathname
    if (
      landed === '/login' &&
      path !== '/login' &&
      (await sessionToken(page, state)) === undefined
    ) {
      throw new Failure(
        `goto ${path} redirected to /login: the browser has no session`,
        noSession(state).next,
      )
    }
    return { ok: true, settled: ok, ...(await where(page)) }
  })

export const snapshot = (instance: Instance, repo: string) =>
  withPage(instance, repo, async (page) => {
    const { timeZone, locale } = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions())
    const aria = (await page.locator('body').ariaSnapshot()).split('\n')
    return { ok: true, ...(await where(page)), timeZone, locale, aria }
  })

export const click = (instance: Instance, repo: string, target: Target) =>
  withPage(instance, repo, async (page, state) => {
    try {
      const element = await find(page, target)
      const clicked = await describe(element)
      const ok = await settled(page, () => element.click())
      return { ok: true, clicked, settled: ok, ...(await where(page)) }
    } catch (error) {
      throw actionFailure(error, state)
    }
  })

export const type = (instance: Instance, repo: string, target: Target, text: string) =>
  withPage(instance, repo, async (page, state) => {
    try {
      const element = await find(page, target)
      const field = await describe(element)
      const ok = await settled(page, () => element.fill(text))
      return { ok: true, typed: text, into: field, settled: ok, ...(await where(page)) }
    } catch (error) {
      throw actionFailure(error, state)
    }
  })

export const press = (instance: Instance, repo: string, key: string) =>
  withPage(instance, repo, async (page) => {
    try {
      const ok = await settled(page, () => page.keyboard.press(key))
      return { ok: true, pressed: key, settled: ok, ...(await where(page)) }
    } catch (error) {
      throw new Failure(
        messageOf(error).split('\n')[0] ?? `cannot press ${key}`,
        'Use a Playwright key name, such as Enter, Escape, Tab, Backspace, ArrowDown or Control+A',
      )
    }
  })

// oxlint-disable-next-line local/no-comments
// Captures through CDP rather than page.screenshot, which scales the PNG down to CSS pixels on a
// context without a Playwright viewport.
export const screenshot = (
  instance: Instance,
  repo: string,
  path: string | undefined,
  mobile: boolean,
) =>
  withPage(instance, repo, async (page, state) => {
    const stamp = new Date().toISOString().replaceAll(':', '-')
    const file = resolve(state.evidenceDir, path ?? `${stamp}${mobile ? '-mobile' : ''}.png`)
    await mkdir(dirname(file), { recursive: true })
    const cdp = await page.context().newCDPSession(page)
    try {
      if (mobile) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          ...MOBILE.viewport,
          deviceScaleFactor: MOBILE.deviceScaleFactor,
          mobile: MOBILE.isMobile,
        })
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: MOBILE.hasTouch })
        await settled(page, () => page.evaluate(() => new Promise(requestAnimationFrame)))
      }
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        deviceScaleFactor: devicePixelRatio,
      }))
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(file, Buffer.from(data, 'base64'))
      return { ok: true, path: file, mobile, viewport, ...(await where(page)) }
    } finally {
      if (mobile) {
        await cdp.send('Emulation.clearDeviceMetricsOverride')
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      }
      await cdp.detach()
    }
  })

export const api = (
  instance: Instance,
  repo: string,
  method: Method,
  path: string,
  body: unknown,
) =>
  withPage(instance, repo, async (page, state) => {
    const token = await sessionToken(page, state)
    if (token === undefined) throw noSession(state)
    const response = await fetch(`${state.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
    })
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {}
    return {
      ok: true,
      request: `${method} ${path}`,
      status: response.status,
      body: parsed,
      ...(response.status === 401 ? { next: noSession(state).next } : {}),
    }
  })
