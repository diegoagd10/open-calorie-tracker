'use client'

import {
  GENERIC_ERROR_MESSAGE,
  WATER_PRESETS,
  type WaterLogEntry,
  filterWaterAmountInput,
  waterEntrySchema,
} from '@open-calorie-tracker/shared'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Alert } from '@/components/alert'
import { Modal } from '@/components/modal'
import { formatNumber, formatTime } from '@/components/food-log/format'
import { type WaterOutcome, addWater, deleteWater, updateWater } from './water-requests'

const BUTTON =
  'flex h-11 items-center justify-center rounded-full px-5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY = `${BUTTON} border border-line bg-bg`
const PRIMARY = `${BUTTON} bg-accent text-on-accent disabled:bg-disabled disabled:text-on-disabled disabled:opacity-100`
const DANGER = `${BUTTON} bg-danger text-white`

// Runs one request at a time. A second click before the buttons re-render is ignored, so a double
// click sends a single request. Done when the request saved or the entry is gone; a failure shows
// the generic error and lets the user try again.
const useSubmission = (onDone: () => void) => {
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

const loggableAmount = (value: string) => {
  const parsed = waterEntrySchema.safeParse({ amount: Number(value) })
  return parsed.success ? parsed.data.amount : undefined
}

function Title({ id, children, subtitle }: { id: string; children: ReactNode; subtitle?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="font-serif text-[28px] leading-tight">
        {children}
      </h2>
      {subtitle !== undefined && <p className="text-sm text-muted">{subtitle}</p>}
    </div>
  )
}

type WaterDialogProps = {
  // The entry to edit; without one the dialog adds a new entry.
  entry?: WaterLogEntry
  onClose: () => void
  // Called once the log changed, or the entry turned out to be gone.
  onChanged: () => void
  onDelete?: () => void
}

// Adds a water entry, or edits one: one tap on a preset saves it, and Custom takes any amount the
// shared rules allow.
export function WaterDialog({ entry, onClose, onChanged, onDelete }: WaterDialogProps) {
  const titleId = useId()
  const fieldId = useId()
  const [custom, setCustom] = useState(entry !== undefined)
  const [value, setValue] = useState(entry === undefined ? '' : String(entry.amount))
  const { pending, failed, submit } = useSubmission(onChanged)
  const amount = loggableAmount(value)
  const field = useRef<HTMLInputElement>(null)

  // Choosing Custom asks for an amount right away; editing shows the current one without focus.
  useEffect(() => {
    if (custom && entry === undefined) field.current?.focus()
  }, [custom, entry])

  const save = (newAmount: number) => {
    if (entry === undefined) return submit(() => addWater(newAmount))
    // Nothing changed, so there is nothing to send.
    if (newAmount === entry.amount) {
      onClose()
      return Promise.resolve()
    }
    return submit(() => updateWater(entry.id, newAmount))
  }

  return (
    <Modal labelledBy={titleId} onDismiss={() => !pending && onClose()}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (amount !== undefined) void save(amount)
        }}
      >
        {entry === undefined ? (
          <Title id={titleId}>Add water</Title>
        ) : (
          <Title id={titleId} subtitle={formatTime(entry.loggedAt)}>
            Edit water
          </Title>
        )}
        <div className="grid grid-cols-3 gap-2">
          {WATER_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              disabled={pending}
              onClick={() => void save(preset.amount)}
              className="flex min-h-16 flex-col items-center justify-center rounded-2xl border border-line bg-bg px-2 py-2 disabled:opacity-60"
            >
              <span className="block font-semibold">{preset.name}</span>
              <span className="block text-xs text-muted">{formatNumber(preset.amount)} fl oz</span>
            </button>
          ))}
        </div>
        {entry === undefined && (
          <button
            type="button"
            disabled={pending}
            aria-pressed={custom}
            onClick={() => setCustom(true)}
            className={SECONDARY}
          >
            Custom
          </button>
        )}
        {custom && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-sm font-medium">
              Amount (fl oz)
            </label>
            <input
              id={fieldId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              ref={field}
              value={value}
              onChange={(event) =>
                setValue((previous) => filterWaterAmountInput(previous, event.target.value))
              }
              className="h-11 rounded-xl border border-line-strong bg-bg px-3.5 outline-none focus:border-accent focus:ring-3 focus:ring-focus"
            />
          </div>
        )}
        {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          {onDelete !== undefined && (
            <button
              type="button"
              disabled={pending}
              onClick={onDelete}
              className={`${SECONDARY} mr-auto text-danger-text`}
            >
              Delete
            </button>
          )}
          <button type="button" disabled={pending} onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          {custom && (
            <button type="submit" disabled={pending || amount === undefined} className={PRIMARY}>
              {entry === undefined ? 'Add' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

type DeleteWaterDialogProps = { entry: WaterLogEntry; onCancel: () => void; onDeleted: () => void }

export function DeleteWaterDialog({ entry, onCancel, onDeleted }: DeleteWaterDialogProps) {
  const titleId = useId()
  const { pending, failed, submit } = useSubmission(onDeleted)

  return (
    <Modal labelledBy={titleId} role="alertdialog" onDismiss={() => !pending && onCancel()}>
      <Title
        id={titleId}
        subtitle={`${formatNumber(entry.amount)} fl oz · ${formatTime(entry.loggedAt)}`}
      >
        Delete this water entry?
      </Title>
      {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pending} onClick={onCancel} className={SECONDARY}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(() => deleteWater(entry.id))}
          className={DANGER}
        >
          Delete
        </button>
      </div>
    </Modal>
  )
}
