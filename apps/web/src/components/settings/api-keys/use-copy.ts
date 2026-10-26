import { useEffect, useRef, useState } from 'react'

export type CopyState = 'copied' | 'failed'

// How long "Copied" or "Couldn’t copy" stays on the button.
const FEEDBACK_MS = 2_000

// Copies text to the clipboard and remembers, for a moment, which button did it and how it went.
// Copying again, from any button, replaces it.
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
