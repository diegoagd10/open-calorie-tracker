'use client'

import { GENERIC_ERROR_MESSAGE, type WaterLogEntry } from '@open-calorie-tracker/shared'
import { useId } from 'react'
import { Alert } from '@/components/alert'
import { formatNumber, formatTime } from '@/components/food-log/format'
import { TrashIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import { DANGER_BUTTON, DialogHeader, GoalBar, SECONDARY_BUTTON } from '@/components/dialog-parts'
import { WaterIcon } from './dialog-parts'
import { useSubmission } from '@/components/use-submission'
import { addAmounts, waterName } from './water-amount'
import { deleteWater } from './water-requests'

type DeleteWaterDialogProps = {
  isToday: boolean
  entry: WaterLogEntry
  // Today's water so far, including this entry, and the daily goal, in fl oz.
  total: number
  goal: number
  // Goes back to editing the entry.
  onKeep: () => void
  // Called once the entry is deleted, or turned out to be gone.
  onDeleted: () => void
}

// Asks before deleting an entry, showing what it takes off today's water.
export function DeleteWaterDialog({
  isToday,
  entry,
  total,
  goal,
  onKeep,
  onDeleted,
}: DeleteWaterDialogProps) {
  const titleId = useId()
  const { pending, failed, submit } = useSubmission(onDeleted)
  const name = waterName(entry.amount)
  const after = addAmounts(total, -entry.amount)

  return (
    <Modal labelledBy={titleId} role="alertdialog" onDismiss={() => !pending && onKeep()}>
      <DialogHeader
        titleId={titleId}
        title={`Delete this ${name === 'Water' ? 'water entry' : name.toLowerCase()}?`}
        subtitle={`It comes off ${isToday ? 'today’s' : 'the'} total. This can’t be undone.`}
      />
      <div className="flex items-center gap-3 rounded-2xl border border-danger-line bg-danger-soft p-3">
        <WaterIcon name={name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="font-semibold">{name}</p>
          <p className="text-xs text-muted">{formatTime(entry.loggedAt)}</p>
        </div>
        <p className="text-danger-text line-through">
          <span className="font-serif text-xl">{formatNumber(entry.amount)}</span>{' '}
          <span className="text-xs">fl oz</span>
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <p className="text-muted">{isToday ? 'Today’s water' : 'Water'}</p>
          <p className="text-muted">
            {formatNumber(total)} →{' '}
            <span className="font-semibold text-fg">{formatNumber(after)}</span> /{' '}
            {formatNumber(goal)} fl oz
          </p>
        </div>
        <GoalBar from={total} to={after} goal={goal} fill="var(--water)" stripes="var(--danger)" />
      </div>
      {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <button type="button" disabled={pending} onClick={onKeep} className={SECONDARY_BUTTON}>
          Keep it
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(() => deleteWater(entry.id))}
          className={DANGER_BUTTON}
        >
          <TrashIcon className="size-5" />
          Delete {formatNumber(entry.amount)} fl oz
        </button>
      </div>
    </Modal>
  )
}
