'use client'

import {
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_NAME_TAKEN_ERROR,
  type ApiKey,
  type ApiKeyExpiresIn,
  GENERIC_ERROR_MESSAGE,
  apiKeyCreateSchema,
  apiKeyExpiresAt,
  sameApiKeyName,
} from '@open-calorie-tracker/shared'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Alert } from '@/components/alert'
import { DialogHeader } from '@/components/dialog-parts'
import { Field } from '@/components/field'
import { KeyIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../section'
import { formatDate } from './format'
import { API_KEYS_URL } from './use-api-keys'

const EXPIRY_CHOICES: { value: ApiKeyExpiresIn; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'never', label: 'Never' },
]

const DEFAULT_EXPIRY: ApiKeyExpiresIn = '90d'

type Outcome = { created: ApiKey } | 'taken' | 'unauthorized' | 'failed'

const sendCreate = async (body: unknown): Promise<Outcome> => {
  try {
    const response = await fetch(API_KEYS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return { created: (await response.json()) as ApiKey }
    if (response.status === 401) return 'unauthorized'
    if (response.status === 409) return 'taken'
    return 'failed'
  } catch {
    return 'failed'
  }
}

const expiryNote = (expiresIn: ApiKeyExpiresIn, from: Date) => {
  const expiresAt = apiKeyExpiresAt(expiresIn, from)
  return expiresAt === null ? 'This key never expires.' : `Expires on ${formatDate(expiresAt)}.`
}

type CreateApiKeyDialogProps = {
  // The user's keys, whose names a new key cannot take.
  keys: readonly ApiKey[]
  onClose: () => void
  onCreated: (key: ApiKey) => void
}

// Asks for a name and how long the key lasts. A name the user already has is flagged while typing,
// and again by the API in case another tab took it meanwhile.
export function CreateApiKeyDialog({ keys, onClose, onCreated }: CreateApiKeyDialogProps) {
  const titleId = useId()
  const expiresLabelId = useId()
  const nameField = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRY)
  // The note says when a key created now would expire.
  const [openedAt] = useState(() => new Date())
  // The API found the name taken; cleared once the name changes.
  const [takenElsewhere, setTakenElsewhere] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  // A second click before the button re-renders disabled is ignored.
  const running = useRef(false)

  // The Modal's effect has opened the dialog by now, which moved the focus to its first button.
  useEffect(() => nameField.current?.focus(), [])

  const taken = takenElsewhere || keys.some((key) => sameApiKeyName(key.name, name))
  const canSubmit = name.trim() !== '' && !taken && !pending
  const close = () => !pending && onClose()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = apiKeyCreateSchema.safeParse({ name, expiresIn })
    if (!canSubmit || running.current || !input.success) return

    running.current = true
    setPending(true)
    setFailed(false)
    const outcome = await sendCreate(input.data)
    if (outcome === 'unauthorized') {
      // The session expired: a full navigation lets the proxy clear it and show the login page.
      window.location.assign('/login')
      return
    }
    if (typeof outcome === 'object') {
      onCreated(outcome.created)
      return
    }
    running.current = false
    setPending(false)
    if (outcome === 'taken') setTakenElsewhere(true)
    else setFailed(true)
  }

  return (
    <Modal labelledBy={titleId} onDismiss={close}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <DialogHeader
          titleId={titleId}
          title="Create API key"
          subtitle="A key acts as you: it can read and change your log."
          onClose={close}
          disabled={pending}
        />
        {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <Field
          ref={nameField}
          label="Name"
          name="api-key-name"
          type="text"
          autoComplete="off"
          maxLength={API_KEY_NAME_MAX_LENGTH}
          value={name}
          error={taken ? API_KEY_NAME_TAKEN_ERROR : undefined}
          hint={`So you can tell your keys apart. Up to ${API_KEY_NAME_MAX_LENGTH} characters.`}
          disabled={pending}
          onChange={(_name, value) => {
            setName(value.slice(0, API_KEY_NAME_MAX_LENGTH))
            setTakenElsewhere(false)
          }}
        />
        <div className="flex flex-col gap-1.5">
          <span id={expiresLabelId} className="text-sm font-medium">
            Expires
          </span>
          <div
            role="radiogroup"
            aria-labelledby={expiresLabelId}
            className="grid grid-cols-4 gap-2"
          >
            {EXPIRY_CHOICES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                // Pills that behave as radio buttons; native radios would need hidden inputs.
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                role="radio"
                aria-checked={value === expiresIn}
                disabled={pending}
                onClick={() => setExpiresIn(value)}
                className="h-10 rounded-full border border-line-strong bg-bg px-2 text-sm whitespace-nowrap transition aria-checked:border-accent aria-checked:font-semibold aria-checked:text-accent-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted">{expiryNote(expiresIn, openedAt)}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={pending} onClick={close} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON}>
            <KeyIcon className="size-4" />
            Create key
          </button>
        </div>
      </form>
    </Modal>
  )
}
