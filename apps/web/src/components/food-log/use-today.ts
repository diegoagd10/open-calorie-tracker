import { useSyncExternalStore } from 'react'

export type Today = { date: string; timeZone: string }

const pad = (value: number) => String(value).padStart(2, '0')

// A string, so React sees the same snapshot until the day or the time zone changes.
const snapshot = () => {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`
}

const subscribe = () => () => {}

// Today's date and time zone in the browser, or null while rendering on the server, which
// cannot know them.
export const useToday = (): Today | null => {
  const value = useSyncExternalStore(subscribe, snapshot, () => null)
  if (value === null) return null
  const [date = '', timeZone = ''] = value.split(' ')
  return { date, timeZone }
}
