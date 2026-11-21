import { useSyncExternalStore } from 'react'

const TAILWIND_SM_AND_UP = '(min-width: 40rem)'

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(TAILWIND_SM_AND_UP)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const useWideScreen = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(TAILWIND_SM_AND_UP).matches,
    () => true,
  )
