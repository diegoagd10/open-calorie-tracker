'use client'

import { type FoodLogEntry, GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import { useId } from 'react'
import { Alert } from '@/components/alert'
import { DANGER_BUTTON, DialogHeader, GoalBar, SECONDARY_BUTTON } from '@/components/dialog-parts'
import { formatNumber, formatTime } from '@/components/food-log/format'
import { ForkKnifeIcon, TrashIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import { useSubmission } from '@/components/use-submission'
import { deleteFood } from './food-requests'
import { roundTenths } from './servings'

type DeleteFoodDialogProps = {
  // The entry as stored, whatever its Edit food form holds.
  entry: FoodLogEntry
  // Today's calories so far, including this entry, and the daily goal, in kcal.
  total: number
  goal: number
  // Goes back to editing the entry.
  onKeep: () => void
  // Called once the entry is deleted, or turned out to be gone.
  onDeleted: () => void
}

// Asks before deleting a food, showing what it takes off today's calories.
export function DeleteFoodDialog({ entry, total, goal, onKeep, onDeleted }: DeleteFoodDialogProps) {
  const titleId = useId()
  const { pending, failed, submit } = useSubmission(onDeleted)
  const after = roundTenths(total - entry.calories)

  return (
    <Modal labelledBy={titleId} role="alertdialog" onDismiss={() => !pending && onKeep()}>
      <DialogHeader
        titleId={titleId}
        title="Delete this food?"
        subtitle="It comes off today’s total. This can’t be undone."
      />
      <div className="flex items-center gap-3 rounded-2xl border border-danger-line bg-danger-soft p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-food-soft text-accent-text">
          <ForkKnifeIcon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate font-semibold">{entry.name}</p>
          <p className="text-xs text-muted">{formatTime(entry.loggedAt)}</p>
          <p className="text-xs text-muted">
            {entry.servingSize} × {formatNumber(entry.quantity)}
          </p>
        </div>
        <p className="text-danger-text line-through">
          <span className="font-serif text-xl">{formatNumber(entry.calories)}</span>{' '}
          <span className="text-xs">kcal</span>
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <p className="text-muted">Today’s calories</p>
          <p className="text-muted">
            {formatNumber(total)} →{' '}
            <span className="font-semibold text-fg">{formatNumber(after)}</span> /{' '}
            {formatNumber(goal)} kcal
          </p>
        </div>
        <GoalBar from={total} to={after} goal={goal} fill="var(--accent)" stripes="var(--danger)" />
      </div>
      {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <button type="button" disabled={pending} onClick={onKeep} className={SECONDARY_BUTTON}>
          Keep it
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(() => deleteFood(entry.id))}
          className={DANGER_BUTTON}
        >
          <TrashIcon className="size-5" />
          Delete {formatNumber(entry.calories)} kcal
        </button>
      </div>
    </Modal>
  )
}
