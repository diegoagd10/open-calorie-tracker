'use client'

import { GENERIC_ERROR_MESSAGE, WATER_PRESETS } from '@open-calorie-tracker/shared'
import { useId, useState } from 'react'
import { Alert } from '@/components/alert'
import { formatNumber } from '@/components/food-log/format'
import { loggedAtOnDay } from '@/components/food-log/selected-day'
import { DropIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import { DialogHeader, GoalBar, SECONDARY_BUTTON } from '@/components/dialog-parts'
import { AmountField, LIMITS_NOTE, PRIMARY_BUTTON, WaterIcon } from './dialog-parts'
import { useSubmission } from '@/components/use-submission'
import { addAmounts, loggableAmount } from './water-amount'
import { addWater } from './water-requests'

type AddWaterDialogProps = {
  day: string | undefined
  isToday: boolean
  // Today's water so far and the daily goal, in fl oz.
  total: number
  goal: number
  onClose: () => void
  onAdded: () => void
}

// One tap on a preset logs it; the field takes any other amount the shared rules allow. Each
// choice shows where it would bring today's water.
export function AddWaterDialog({
  day,
  isToday,
  total,
  goal,
  onClose,
  onAdded,
}: AddWaterDialogProps) {
  const titleId = useId()
  const [value, setValue] = useState('')
  const { pending, failed, submit } = useSubmission(onAdded)
  const amount = loggableAmount(value)
  const close = () => !pending && onClose()
  const log = (newAmount: number) =>
    void submit(() =>
      addWater({
        amount: newAmount,
        ...(day === undefined ? {} : { loggedAt: loggedAtOnDay(day) }),
      }),
    )

  const toGo = total >= goal ? 'goal reached' : `${formatNumber(addAmounts(goal, -total))} to go`

  return (
    <Modal labelledBy={titleId} onDismiss={close}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (amount !== undefined) log(amount)
        }}
      >
        <DialogHeader
          titleId={titleId}
          title="Add water"
          subtitle={`${formatNumber(total)} of ${formatNumber(goal)} fl oz${isToday ? ' today' : ''} · ${toGo}`}
          onClose={close}
          disabled={pending}
        />
        <div className="flex flex-col gap-2">
          <GoalBar
            from={total}
            to={addAmounts(total, amount ?? 0)}
            goal={goal}
            fill="var(--water)"
            stripes="var(--water)"
          />
          {amount !== undefined && (
            <p className="text-xs">
              With {formatNumber(amount)} fl oz: {formatNumber(addAmounts(total, amount))} /{' '}
              {formatNumber(goal)} fl oz
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">One tap logs it</p>
          <div className="grid grid-cols-3 gap-2">
            {WATER_PRESETS.map((preset) => {
              const after = addAmounts(total, preset.amount)
              return (
                <button
                  key={preset.name}
                  type="button"
                  disabled={pending}
                  onClick={() => log(preset.amount)}
                  className="flex flex-col items-start gap-2 rounded-2xl border border-line bg-bg p-3 text-left disabled:opacity-60"
                >
                  <WaterIcon name={preset.name} />
                  <span className="flex flex-col">
                    <span className="font-semibold">{preset.name}</span>
                    <span>
                      <span className="font-serif text-xl">{formatNumber(preset.amount)}</span>{' '}
                      <span className="text-xs text-muted">fl oz</span>
                    </span>
                  </span>
                  {after >= goal ? (
                    <span className="text-xs text-accent-text">Goal reached</span>
                  ) : (
                    <span className="text-xs text-muted">
                      → {formatNumber(after)}
                      {isToday ? ' today' : ''}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          or a custom amount
          <span className="h-px flex-1 bg-line" />
        </div>
        <AmountField value={value} onChange={setValue} disabled={pending} note={LIMITS_NOTE} />
        {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" disabled={pending} onClick={close} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || amount === undefined}
            className={PRIMARY_BUTTON}
          >
            <DropIcon className="size-5" />
            {amount === undefined ? 'Add' : `Add ${formatNumber(amount)} fl oz`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
