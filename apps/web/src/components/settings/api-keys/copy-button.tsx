import { CheckIcon, CopyIcon } from '@/components/icons'
import type { CopyState } from './use-copy'

export const SMALL_BUTTON =
  'flex h-9 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-bg px-3.5 text-sm font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60'

const COPIED_BUTTON = `${SMALL_BUTTON} border-accent text-accent-text`

// "Copy", then "Copied" or "Couldn’t copy" for a moment after a click.
export function CopyButton({
  state,
  onCopy,
  className = '',
}: {
  state: CopyState | undefined
  onCopy: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className={`${state === 'copied' ? COPIED_BUTTON : SMALL_BUTTON} ${className}`}
    >
      {state === 'copied' ? (
        <>
          <CheckIcon className="size-4" />
          Copied
        </>
      ) : state === 'failed' ? (
        'Couldn’t copy'
      ) : (
        <>
          <CopyIcon className="size-4" />
          Copy
        </>
      )}
    </button>
  )
}
