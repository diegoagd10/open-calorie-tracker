'use client'

import {
  type ChangePasswordInput,
  GENERIC_ERROR_MESSAGE,
  INCORRECT_CURRENT_PASSWORD_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MISMATCH_MESSAGE,
  changePasswordSchema,
} from '@open-calorie-tracker/shared'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Alert } from '@/components/alert'
import { Field } from '@/components/field'
import { Modal } from '@/components/modal'
import { DialogHeader } from '@/components/dialog-parts'
import { type FieldErrors, fieldErrorsFrom, passwordInput } from '@/lib/form'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './section'

type FieldName = keyof ChangePasswordInput

const FIELDS: readonly FieldName[] = ['currentPassword', 'newPassword', 'confirmPassword']

const EMPTY: ChangePasswordInput = { currentPassword: '', newPassword: '', confirmPassword: '' }

type Outcome = 'changed' | 'incorrect' | 'unauthorized' | 'failed'

const sendChange = async (input: ChangePasswordInput): Promise<Outcome> => {
  try {
    const response = await fetch('/api/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (response.ok) return 'changed'
    if (response.status === 401) return 'unauthorized'
    if (response.status === 403) return 'incorrect'
    return 'failed'
  } catch {
    return 'failed'
  }
}

type ChangePasswordDialogProps = {
  onClose: () => void
  onChanged: () => void
}

// Asks for the current password and a new one typed twice. The submit button waits until the two
// new passwords match; the other rules are checked on submit, and again by the API.
export function ChangePasswordDialog({ onClose, onChanged }: ChangePasswordDialogProps) {
  const titleId = useId()
  const currentField = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<FieldName>>({})
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  // A second click before the button re-renders disabled is ignored.
  const running = useRef(false)

  // The Modal's effect has opened the dialog by now, which moved the focus to its first button.
  useEffect(() => currentField.current?.focus(), [])

  const { newPassword, confirmPassword } = values
  const mismatch = newPassword !== '' && confirmPassword !== '' && newPassword !== confirmPassword
  const canSubmit = FIELDS.every((name) => values[name] !== '') && !mismatch && !pending
  const close = () => !pending && onClose()

  const handleChange = (name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: passwordInput(value) }))
    setFieldErrors((current) => ({ ...current, [name]: undefined }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || running.current) return
    setFailed(false)

    const input = changePasswordSchema.safeParse(values)
    if (!input.success) {
      setFieldErrors(fieldErrorsFrom(FIELDS, input.error.issues))
      return
    }
    setFieldErrors({})

    running.current = true
    setPending(true)
    const outcome = await sendChange(input.data)
    if (outcome === 'changed') {
      onChanged()
      return
    }
    if (outcome === 'unauthorized') {
      // The session expired: a full navigation lets the proxy clear it and show the login page.
      window.location.assign('/login')
      return
    }
    running.current = false
    setPending(false)
    if (outcome === 'incorrect') {
      setFieldErrors({ currentPassword: INCORRECT_CURRENT_PASSWORD_MESSAGE })
    } else {
      setFailed(true)
    }
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
          title="Change password"
          subtitle="Enter your current password, then choose a new one."
          onClose={close}
          disabled={pending}
        />
        {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <Field
          ref={currentField}
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={values.currentPassword}
          error={fieldErrors.currentPassword}
          disabled={pending}
          onChange={handleChange}
        />
        <Field
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={values.newPassword}
          error={fieldErrors.newPassword}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          disabled={pending}
          onChange={handleChange}
        />
        <Field
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={values.confirmPassword}
          error={mismatch ? PASSWORD_MISMATCH_MESSAGE : fieldErrors.confirmPassword}
          disabled={pending}
          onChange={handleChange}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={pending} onClick={close} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON}>
            {pending ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
