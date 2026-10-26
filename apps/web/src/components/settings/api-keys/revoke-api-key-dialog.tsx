'use client'

import { type ApiKey, GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import { useId } from 'react'
import { Alert } from '@/components/alert'
import { DANGER_BUTTON, DialogHeader, SECONDARY_BUTTON } from '@/components/dialog-parts'
import { TrashIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import { sendRequest } from '@/components/requests'
import { useSubmission } from '@/components/use-submission'
import { lastUsedLabel } from './format'
import { API_KEYS_URL } from './use-api-keys'

type RevokeApiKeyDialogProps = {
  apiKey: ApiKey
  // The timestamp "Last used" counts from.
  now: number
  onKeep: () => void
  // Called once the key is deleted, or turned out to be gone already.
  onRevoked: () => void
}

// Asks before deleting a key that still works.
export function RevokeApiKeyDialog({ apiKey, now, onKeep, onRevoked }: RevokeApiKeyDialogProps) {
  const titleId = useId()
  const { pending, failed, submit } = useSubmission(onRevoked)

  const revoke = async () => (await sendRequest('DELETE', `${API_KEYS_URL}/${apiKey.id}`)).outcome

  return (
    <Modal labelledBy={titleId} role="alertdialog" onDismiss={() => !pending && onKeep()}>
      <DialogHeader
        titleId={titleId}
        title="Revoke this key?"
        subtitle="Apps using it stop working right away. This can’t be undone."
        icon={
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-text">
            <TrashIcon className="size-5" />
          </span>
        }
      />
      <div className="flex flex-col gap-0.5 rounded-2xl border border-line bg-bg p-3">
        <p className="font-semibold">{apiKey.name}</p>
        <p className="font-mono text-xs text-fg-soft">{apiKey.preview}</p>
        <p className="text-xs text-muted">{lastUsedLabel(apiKey, now)}</p>
      </div>
      {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <button type="button" disabled={pending} onClick={onKeep} className={SECONDARY_BUTTON}>
          Keep it
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(revoke)}
          className={DANGER_BUTTON}
        >
          Revoke key
        </button>
      </div>
    </Modal>
  )
}
