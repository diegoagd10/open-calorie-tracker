import type { Browser, BrowserContextOptions, Locator, Page } from 'playwright'

export const TIME_ZONE = 'America/New_York'

export const openPage = async (browser: Browser, options: BrowserContextOptions = {}) => {
  const context = await browser.newContext({ timezoneId: TIME_ZONE, locale: 'en-US', ...options })
  const page = await context.newPage()
  page.setDefaultTimeout(5_000)
  return { context, page }
}

export const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

export const textOf = async (locator: Locator) =>
  (await locator.innerText()).replaceAll(/\s+/g, ' ').trim()

export const eventually = { timeout: 5_000, interval: 100 }

export const box = async (locator: Locator) => {
  const bounds = await locator.boundingBox()
  if (bounds === null) throw new Error('The element is hidden')
  return bounds
}

export const sameRow = async (a: Locator, b: Locator) => {
  const first = await box(a)
  const second = await box(b)
  return second.y < first.y + first.height && second.y + second.height > first.y
}

export const isHidden = (locator: Locator) => async () => !(await locator.isVisible())

export const holdRequests = async (page: Page, pattern: string, method?: string) => {
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(pattern, async (route) => {
    if (method === undefined || route.request().method() === method) await released
    await route.continue()
  })
  return release
}
