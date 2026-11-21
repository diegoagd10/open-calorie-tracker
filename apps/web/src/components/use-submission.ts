import { useRef, useState } from 'react'
import type { Outcome } from './requests'

export const useSubmission = (onDone: () => void) => {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const running = useRef(false)

  const submit = async (request: () => Promise<Outcome>) => {
    if (running.current) return
    running.current = true
    setPending(true)
    setFailed(false)
    const outcome = await request()
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
