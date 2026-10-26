'use client'

import type { ApiKey } from '@open-calorie-tracker/shared'
import { useId } from 'react'
import { DialogHeader } from '@/components/dialog-parts'
import { CheckIcon, InfoIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import { PRIMARY_BUTTON } from '../section'
import { CopyButton } from './copy-button'
import { formatDate } from './format'
import { useCopy } from './use-copy'

// Shows the key just created, with how to send it. Done, Escape and a click outside all close it.
export function KeyCreatedDialog({ apiKey, onDone }: { apiKey: ApiKey; onDone: () => void }) {
  const titleId = useId()
  const keyFieldId = useId()
  const { copy, stateOf } = useCopy<'key'>()
  const expiry =
    apiKey.expiresAt === null ? 'never expires' : `expires ${formatDate(apiKey.expiresAt)}`

  return (
    <Modal labelledBy={titleId} onDismiss={onDone}>
      <DialogHeader
        titleId={titleId}
        title="Key created"
        subtitle={`${apiKey.name} · ${expiry}`}
        icon={
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-food-soft text-accent-text">
            <CheckIcon className="size-5" />
          </span>
        }
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={keyFieldId} className="text-sm font-medium">
          Your API key
        </label>
        <div className="flex gap-2">
          <input
            id={keyFieldId}
            type="text"
            readOnly
            value={apiKey.key}
            onFocus={(event) => event.target.select()}
            className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-bg px-3.5 font-mono text-sm"
          />
          <CopyButton
            state={stateOf('key')}
            onCopy={() => void copy('key', apiKey.key)}
            className="h-11"
          />
        </div>
      </div>
      <p className="flex gap-2.5 rounded-xl border border-line p-3 text-sm text-fg-soft">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted" />
        You can copy it again anytime from Settings › API keys. Keep it private: it works like your
        password.
      </p>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted">Send it in the Authorization header:</p>
        <code className="rounded-lg bg-bg px-3 py-2.5 font-mono text-xs break-all">
          Authorization: Bearer {apiKey.preview}
        </code>
      </div>
      <button type="button" onClick={onDone} className={`${PRIMARY_BUTTON} sm:w-full`}>
        Done
      </button>
    </Modal>
  )
}
