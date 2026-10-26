import { useSyncExternalStore } from 'react'

// Tailwind's sm breakpoint.
const WIDE = '(min-width: 40rem)'

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(WIDE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

// Whether the window is at least as wide as the sm breakpoint, for content that differs and not
// only its layout.
export const useWideScreen = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => true,
  )
