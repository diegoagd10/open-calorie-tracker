import type { Browser, BrowserContextOptions, Locator } from 'playwright'

export const TIME_ZONE = 'America/New_York'

// A fresh context per test, so no cookies leak between tests, in the time zone and locale the
// tests expect. Options such as a mobile device are added on top.
export const openPage = async (browser: Browser, options: BrowserContextOptions = {}) => {
  const context = await browser.newContext({ timezoneId: TIME_ZONE, locale: 'en-US', ...options })
  const page = await context.newPage()
  page.setDefaultTimeout(5_000)
  return { context, page }
}

export const textOf = async (locator: Locator) =>
  (await locator.innerText()).replaceAll(/\s+/g, ' ').trim()

// Waits for the UI to settle on a value, since data loads after the page renders.
export const eventually = { timeout: 5_000, interval: 100 }

export const box = async (locator: Locator) => {
  const bounds = await locator.boundingBox()
  if (bounds === null) throw new Error('The element is hidden')
  return bounds
}

// Whether the two elements overlap vertically, as items of one row do.
export const sameRow = async (a: Locator, b: Locator) => {
  const first = await box(a)
  const second = await box(b)
  return second.y < first.y + first.height && second.y + second.height > first.y
}
