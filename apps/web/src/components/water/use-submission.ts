import { useRef, useState } from 'react'
import type { WaterOutcome } from './water-requests'

// Runs one request at a time. A second click before the buttons re-render is ignored, so a double
// click sends a single request. Done when the request saved or the entry is gone; a failure shows
// the generic error and lets the user try again.
export const useSubmission = (onDone: () => void) => {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const running = useRef(false)

  const submit = async (request: () => Promise<WaterOutcome>) => {
    if (running.current) return
    running.current = true
    setPending(true)
    setFailed(false)
    const outcome = await request()
    // The page is leaving for the login page.
    if (outcome === 'unauthorized') return
    if (outcome === 'failed') {
      running.current = false
      setPending(false)
      setFailed(true)
      return
    }
    onDone()
  }

  return { pending, failed, submit }
}
