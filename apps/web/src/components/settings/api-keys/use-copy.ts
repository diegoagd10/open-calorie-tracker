import { useEffect, useRef, useState } from 'react'

export type CopyState = 'copied' | 'failed'

const FEEDBACK_MS = 2_000

export const useCopy = <Target>() => {
  const [result, setResult] = useState<{ target: Target; state: CopyState }>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async (target: Target, text: string) => {
    let state: CopyState
    try {
      await navigator.clipboard.writeText(text)
      state = 'copied'
    } catch {
      state = 'failed'
    }
    clearTimeout(timer.current)
    setResult({ target, state })
    timer.current = setTimeout(() => setResult(undefined), FEEDBACK_MS)
  }

  const stateOf = (target: Target) => (result?.target === target ? result.state : undefined)

  return { copy, stateOf }
}
