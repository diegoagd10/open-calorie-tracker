import type { ApiKey } from '@open-calorie-tracker/shared'

// How the API keys section shows dates, in the browser's time zone. `now` is a timestamp.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

// "Jan 24, 2027".
export const formatDate = (instant: string | Date) => dateFormat.format(new Date(instant))

const localDay = (instant: number) => new Date(instant).toDateString()

const isToday = (instant: number, now: number) => localDay(instant) === localDay(now)

const isYesterday = (instant: number, now: number) => {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return localDay(instant) === yesterday.toDateString()
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`

// A key past its expiry instant no longer works.
export const isExpired = (key: ApiKey, now: number) =>
  key.expiresAt !== null && Date.parse(key.expiresAt) <= now

export const createdLabel = (key: ApiKey, now: number) => {
  const createdAt = Date.parse(key.createdAt)
  return isToday(createdAt, now) ? 'Created today' : `Created ${formatDate(key.createdAt)}`
}

// "Last used 2 hours ago" within a day, then "yesterday", then the date.
export const lastUsedLabel = (key: ApiKey, now: number) => {
  if (key.lastUsedAt === null) return 'Never used'
  const lastUsedAt = Date.parse(key.lastUsedAt)
  const elapsed = now - lastUsedAt
  if (elapsed < MINUTE) return 'Last used just now'
  if (elapsed < HOUR) return `Last used ${plural(Math.floor(elapsed / MINUTE), 'minute')} ago`
  if (elapsed < DAY) return `Last used ${plural(Math.floor(elapsed / HOUR), 'hour')} ago`
  if (isYesterday(lastUsedAt, now)) return 'Last used yesterday'
  return `Last used ${formatDate(key.lastUsedAt)}`
}

export const expiryLabel = (key: ApiKey, now: number) => {
  if (key.expiresAt === null) return 'Never expires'
  return `${isExpired(key, now) ? 'Expired' : 'Expires'} ${formatDate(key.expiresAt)}`
}
