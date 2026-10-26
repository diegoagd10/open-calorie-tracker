'use client'

import { type ApiKey, GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import { useState } from 'react'
import { Alert } from '@/components/alert'
import { ClockIcon, KeyIcon, PlusIcon } from '@/components/icons'
import { sendRequest } from '@/components/requests'
import { PRIMARY_BUTTON, Section } from '../section'
import { CopyButton, SMALL_BUTTON } from './copy-button'
import { CreateApiKeyDialog } from './create-api-key-dialog'
import { createdLabel, expiryLabel, isExpired, lastUsedLabel } from './format'
import { KeyCreatedDialog } from './key-created-dialog'
import { RevokeApiKeyDialog } from './revoke-api-key-dialog'
import { API_KEYS_URL, useApiKeys } from './use-api-keys'
import { useCopy } from './use-copy'
import { useWideScreen } from './use-wide-screen'

type Dialog =
  | { kind: 'create' }
  | { kind: 'created'; apiKey: ApiKey }
  | { kind: 'revoke'; apiKey: ApiKey }

function CreateButton({
  disabled,
  onClick,
  className = '',
}: {
  disabled: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${PRIMARY_BUTTON} ${className}`}
    >
      <PlusIcon className="size-4" />
      Create API key
    </button>
  )
}

const BADGE = 'rounded-full px-2 py-0.5 text-xs font-semibold'

type KeyItemProps = {
  apiKey: ApiKey
  now: number
  isNew: boolean
  wide: boolean
  copyState: 'copied' | 'failed' | undefined
  deleting: boolean
  onCopy: () => void
  onRevoke: () => void
  onDelete: () => void
}

// A key that still works can be copied or revoked; an expired one can only be deleted.
function KeyItem({
  apiKey,
  now,
  isNew,
  wide,
  copyState,
  deleting,
  onCopy,
  onRevoke,
  onDelete,
}: KeyItemProps) {
  const expired = isExpired(apiKey, now)
  // Phones leave out when the key was created, to keep the line short. An expired key no longer
  // works, so when it was last used no longer matters.
  const details = [
    ...(wide ? [createdLabel(apiKey, now)] : []),
    ...(expired ? [] : [lastUsedLabel(apiKey, now)]),
    expiryLabel(apiKey, now),
  ].join(' · ')

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={`hidden size-10 shrink-0 items-center justify-center rounded-xl sm:flex ${
            expired
              ? 'bg-danger-soft text-danger-text'
              : isNew
                ? 'bg-food-soft text-accent-text'
                : 'bg-bg text-muted'
          }`}
        >
          {expired ? <ClockIcon className="size-5" /> : <KeyIcon className="size-5" />}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold break-words">{apiKey.name}</span>
            {isNew && !expired && <span className={`${BADGE} bg-accent text-on-accent`}>New</span>}
            {expired && (
              <span className={`${BADGE} border border-danger-line text-danger-text`}>Expired</span>
            )}
          </p>
          <p className="font-mono text-sm text-fg-soft">{apiKey.preview}</p>
          <p className="text-xs text-muted">{details}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {expired ? (
          <button type="button" disabled={deleting} onClick={onDelete} className={SMALL_BUTTON}>
            Delete
          </button>
        ) : (
          <>
            <CopyButton state={copyState} onCopy={onCopy} />
            <button type="button" onClick={onRevoke} className={SMALL_BUTTON}>
              Revoke
            </button>
          </>
        )}
      </div>
    </li>
  )
}

// The user's API keys: create them, copy them whenever needed, and revoke them.
export function ApiKeysSection() {
  const { keys, loadedAt: now, failed, add, drop } = useApiKeys()
  const [dialog, setDialog] = useState<Dialog>()
  // Keys created since the page loaded.
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set())
  const [deleting, setDeleting] = useState<number>()
  const [deleteFailed, setDeleteFailed] = useState(false)
  const { copy, stateOf } = useCopy<number>()
  const wide = useWideScreen()

  const openCreate = () => setDialog({ kind: 'create' })
  const closeDialog = () => setDialog(undefined)

  // Expired keys are deleted at once, since no app can use them anymore.
  const deleteExpired = async (apiKey: ApiKey) => {
    if (deleting !== undefined) return
    setDeleting(apiKey.id)
    setDeleteFailed(false)
    const { outcome } = await sendRequest('DELETE', `${API_KEYS_URL}/${apiKey.id}`)
    setDeleting(undefined)
    if (outcome === 'saved' || outcome === 'gone') drop(apiKey.id)
    else if (outcome === 'failed') setDeleteFailed(true)
  }

  const hasKeys = keys !== undefined && keys.length > 0

  return (
    <Section
      id="api-keys"
      title="API keys"
      description="Keys for connecting other apps to your account."
      action={
        hasKeys && (
          <CreateButton disabled={false} onClick={openCreate} className="hidden shrink-0 sm:flex" />
        )
      }
    >
      {(failed || deleteFailed) && (
        <div className="px-4 pt-4 sm:px-5">
          <Alert>{GENERIC_ERROR_MESSAGE}</Alert>
        </div>
      )}
      {keys === undefined ? (
        // Loading, or loading failed.
        <div className="p-4 sm:p-5">
          <CreateButton disabled onClick={openCreate} />
        </div>
      ) : keys.length === 0 ? (
        <div className="p-4 sm:p-5">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-bg text-muted">
              <KeyIcon className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">No API keys yet</p>
              <p className="max-w-sm text-sm text-muted">
                Create one to log food and water from scripts, shortcuts or other apps.
              </p>
            </div>
            <CreateButton disabled={false} onClick={openCreate} />
          </div>
        </div>
      ) : (
        <>
          <ul aria-label="API keys" className="mx-4 divide-y divide-line sm:mx-5">
            {keys.map((apiKey) => (
              <KeyItem
                key={apiKey.id}
                apiKey={apiKey}
                now={now}
                isNew={newIds.has(apiKey.id)}
                wide={wide}
                copyState={stateOf(apiKey.id)}
                deleting={deleting === apiKey.id}
                onCopy={() => void copy(apiKey.id, apiKey.key)}
                onRevoke={() => setDialog({ kind: 'revoke', apiKey })}
                onDelete={() => void deleteExpired(apiKey)}
              />
            ))}
          </ul>
          <div className="border-t border-line p-4 sm:hidden">
            <CreateButton disabled={false} onClick={openCreate} className="w-full" />
          </div>
          <p className="hidden border-t border-line px-5 py-3 text-xs text-muted sm:block">
            Copy puts the full key on your clipboard. Anyone with a key can use your account: revoke
            it if it leaks.
          </p>
        </>
      )}
      {dialog?.kind === 'create' && keys !== undefined && (
        <CreateApiKeyDialog
          keys={keys}
          onClose={closeDialog}
          onCreated={(apiKey) => {
            add(apiKey)
            setNewIds((current) => new Set([...current, apiKey.id]))
            setDialog({ kind: 'created', apiKey })
          }}
        />
      )}
      {dialog?.kind === 'created' && (
        <KeyCreatedDialog apiKey={dialog.apiKey} onDone={closeDialog} />
      )}
      {dialog?.kind === 'revoke' && (
        <RevokeApiKeyDialog
          apiKey={dialog.apiKey}
          now={now}
          onKeep={closeDialog}
          onRevoked={() => {
            drop(dialog.apiKey.id)
            closeDialog()
          }}
        />
      )}
    </Section>
  )
}
