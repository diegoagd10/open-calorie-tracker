import { useSyncExternalStore } from 'react'

export type Today = { date: string; timeZone: string }

const pad = (value: number) => String(value).padStart(2, '0')

// oxlint-disable-next-line local/no-comments
// A string, so React sees the same snapshot until the day or the time zone changes.
const snapshot = () => {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`
}

const subscribe = () => () => {}

export const useToday = (): Today | null => {
  const value = useSyncExternalStore(subscribe, snapshot, () => null)
  if (value === null) return null
  const [date = '', timeZone = ''] = value.split(' ')
  return { date, timeZone }
}
