'use client'

import {
  GENERIC_ERROR_MESSAGE,
  WATER_PRESETS,
  type WaterLogEntry,
} from '@open-calorie-tracker/shared'
import { useId, useState } from 'react'
import { Alert } from '@/components/alert'
import { formatNumber, formatTime } from '@/components/food-log/format'
import { TrashIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import {
  AmountField,
  DialogHeader,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  WaterIcon,
} from './dialog-parts'
import { useSubmission } from './use-submission'
import { addAmounts, loggableAmount, waterName } from './water-amount'
import { updateWater } from './water-requests'

type EditWaterDialogProps = {
  entry: WaterLogEntry
  // Today's water so far, in fl oz, including this entry.
  total: number
  onClose: () => void
  // Called once the entry changed, or turned out to be gone.
  onChanged: () => void
  onDelete: () => void
}

// Changes the amount of an entry; it keeps its time. One tap on a preset saves it.
export function EditWaterDialog({
  entry,
  total,
  onClose,
  onChanged,
  onDelete,
}: EditWaterDialogProps) {
  const titleId = useId()
  const [value, setValue] = useState(String(entry.amount))
  const { pending, failed, submit } = useSubmission(onChanged)
  const amount = loggableAmount(value)
  const name = waterName(entry.amount)
  const close = () => !pending && onClose()

  const save = (newAmount: number) => {
    // Nothing changed, so there is nothing to send.
    if (newAmount === entry.amount) onClose()
    else void submit(() => updateWater(entry.id, newAmount))
  }

  return (
    <Modal labelledBy={titleId} onDismiss={close}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (amount !== undefined) save(amount)
        }}
      >
        <DialogHeader
          titleId={titleId}
          title="Edit water"
          subtitle={`${name} · logged at ${formatTime(entry.loggedAt)}`}
          icon={<WaterIcon name={name} size="large" />}
          onClose={close}
          disabled={pending}
        />
        <div className="rounded-2xl border border-line bg-bg/40 p-4">
          <AmountField
            value={value}
            onChange={setValue}
            disabled={pending}
            size="large"
            {...(amount === undefined
              ? {}
              : {
                  note: `Was ${formatNumber(entry.amount)} · today ${formatNumber(total)} → ${formatNumber(
                    addAmounts(total, amount - entry.amount),
                  )} fl oz`,
                })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">Set to</p>
          <div className="grid grid-cols-3 gap-2">
            {WATER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                disabled={pending}
                onClick={() => save(preset.amount)}
                className="flex h-11 items-center justify-center gap-1 rounded-full border border-line bg-bg text-sm disabled:opacity-60"
              >
                <span className="font-semibold">{preset.name}</span>{' '}
                <span className="text-muted">{formatNumber(preset.amount)}</span>
              </button>
            ))}
          </div>
        </div>
        {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            className="flex h-12 items-center gap-2 justify-self-start px-1 font-semibold text-danger-text disabled:opacity-60"
          >
            <TrashIcon className="size-5" />
            Delete
          </button>
          <button type="button" disabled={pending} onClick={close} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || amount === undefined}
            className={PRIMARY_BUTTON}
          >
            {amount === undefined ? 'Save' : `Save ${formatNumber(amount)} fl oz`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
