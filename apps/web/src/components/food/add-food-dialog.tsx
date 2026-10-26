'use client'

import {
  type FoodEntryInput,
  GENERIC_ERROR_MESSAGE,
  MAX_FOOD_NAME_LENGTH,
  type ServingSize,
  filterPerServingInput,
  normalizeServingSize,
} from '@open-calorie-tracker/shared'
import { useEffect, useId, useState } from 'react'
import { Alert } from '@/components/alert'
import { BUTTON, DialogHeader, GoalBar, SECONDARY_BUTTON } from '@/components/dialog-parts'
import { formatNumber } from '@/components/food-log/format'
import { ForkKnifeIcon, MinusIcon, PlusIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import type { Outcome } from '@/components/requests'
import { useSubmission } from '@/components/use-submission'
import { addFood, loadServingSizes, saveServingSize } from './food-requests'
import {
  NO_NUTRIENTS,
  NUTRIENT_FIELDS,
  type NutrientValues,
  NutrientsSection,
} from './nutrients-section'
import { ServingSizeField, findServingSize } from './serving-size-field'
import {
  addServing,
  canAddServing,
  canRemoveServing,
  goalStatus,
  perServingValue,
  removeServing,
  roundTenths,
} from './servings'

const PRIMARY_BUTTON = `${BUTTON} bg-accent text-on-accent disabled:bg-disabled disabled:text-on-disabled disabled:opacity-100`

const INPUT_BOX =
  'flex items-center gap-2 rounded-xl border border-line-strong bg-bg px-3.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-focus'

const STEPPER = 'flex h-full w-11 items-center justify-center disabled:opacity-40'

type AddFoodDialogProps = {
  // Today's calories so far and the daily goal, in kcal.
  total: number
  goal: number
  onClose: () => void
  onAdded: () => void
}

// Logs a food as its label prints it, per serving, times the servings eaten. Shows where the
// entry would bring today's calories.
export function AddFoodDialog({ total, goal, onClose, onAdded }: AddFoodDialogProps) {
  const titleId = useId()
  const nameId = useId()
  const caloriesId = useId()
  const servingsLabelId = useId()
  const [name, setName] = useState('')
  const [servingSize, setServingSize] = useState('')
  const [servingSizes, setServingSizes] = useState<ServingSize[]>([])
  const [listOpen, setListOpen] = useState(false)
  const [servings, setServings] = useState(1)
  const [calories, setCalories] = useState('')
  const [nutrients, setNutrients] = useState<NutrientValues>(NO_NUTRIENTS)
  const { pending, failed, submit } = useSubmission(onAdded)

  useEffect(() => {
    let current = true
    void loadServingSizes().then((loaded) => {
      if (current) setServingSizes(loaded)
    })
    return () => {
      current = false
    }
  }, [])

  const perServing = perServingValue(calories)
  const entryCalories = roundTenths((perServing ?? 0) * servings)
  const after = roundTenths(total + entryCalories)
  const over = after > goal
  const complete =
    name.trim() !== '' && normalizeServingSize(servingSize) !== '' && perServing !== undefined

  const close = () => !pending && onClose()

  // Saves a new serving size first; once saved it is the user's, so a retry reuses it.
  const save = async (): Promise<Outcome> => {
    let chosen = findServingSize(servingSizes, servingSize)
    if (chosen === undefined) {
      const saved = await saveServingSize(normalizeServingSize(servingSize))
      if (saved.servingSize === undefined) return saved.outcome
      chosen = saved.servingSize
      setServingSizes((current) => [...current, saved.servingSize as ServingSize])
    }
    const entry: FoodEntryInput = {
      name: name.trim(),
      servingSizeId: chosen.id,
      quantity: servings,
      calories: perServing ?? 0,
    }
    for (const { key } of NUTRIENT_FIELDS) {
      const value = perServingValue(nutrients[key])
      if (value !== undefined) entry[key] = value
    }
    return addFood(entry)
  }

  return (
    <Modal labelledBy={titleId} onDismiss={close}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (complete) void submit(save)
        }}
      >
        <DialogHeader
          titleId={titleId}
          title="Add food"
          subtitle={`${formatNumber(total)} of ${formatNumber(goal)} kcal today · ${goalStatus(total, goal)}`}
          icon={
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-food-soft text-accent-text">
              <ForkKnifeIcon className="size-6" />
            </span>
          }
          onClose={close}
          disabled={pending}
        />
        <div className="flex flex-col gap-2">
          <GoalBar
            from={total}
            to={after}
            goal={goal}
            fill="var(--accent)"
            stripes={over ? 'var(--danger)' : 'var(--accent)'}
          />
          {perServing !== undefined && (
            <p className={`text-xs ${over ? 'text-danger-text' : 'text-fg-soft'}`}>
              With {formatNumber(entryCalories)} kcal: {formatNumber(after)} / {formatNumber(goal)}{' '}
              kcal{over && ` · ${formatNumber(roundTenths(after - goal))} over`}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            Food
          </label>
          <input
            id={nameId}
            type="text"
            autoComplete="off"
            placeholder="e.g. Greek yogurt with honey"
            maxLength={MAX_FOOD_NAME_LENGTH}
            disabled={pending}
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, MAX_FOOD_NAME_LENGTH))}
            onFocus={() => setListOpen(false)}
            className={`${INPUT_BOX} h-12 outline-none placeholder:text-muted`}
          />
        </div>
        <ServingSizeField
          value={servingSize}
          onChange={setServingSize}
          servingSizes={servingSizes}
          open={listOpen}
          onOpenChange={setListOpen}
          disabled={pending}
          aside={
            <div className="flex flex-col gap-1.5">
              <span id={servingsLabelId} className="text-sm font-medium">
                Servings
              </span>
              <fieldset
                aria-labelledby={servingsLabelId}
                className="m-0 flex h-12 min-w-0 items-center rounded-full border border-line-strong bg-bg p-0"
              >
                <button
                  type="button"
                  aria-label="Fewer servings"
                  disabled={pending || !canRemoveServing(servings)}
                  onClick={() => setServings(removeServing(servings))}
                  className={STEPPER}
                >
                  <MinusIcon className="size-[18px]" />
                </button>
                <span aria-live="polite" className="min-w-9 text-center font-serif text-[22px]">
                  {formatNumber(servings)}
                </span>
                <button
                  type="button"
                  aria-label="More servings"
                  disabled={pending || !canAddServing(servings)}
                  onClick={() => setServings(addServing(servings))}
                  className={STEPPER}
                >
                  <PlusIcon className="size-[18px]" />
                </button>
              </fieldset>
            </div>
          }
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={caloriesId} className="text-sm font-medium">
            Calories per serving
          </label>
          <div className={`${INPUT_BOX} h-14`}>
            <input
              id={caloriesId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              disabled={pending}
              value={calories}
              onChange={(event) => setCalories(filterPerServingInput(calories, event.target.value))}
              onFocus={() => setListOpen(false)}
              className="w-full min-w-0 bg-transparent font-serif text-[28px] outline-none placeholder:text-muted"
            />
            <span className="text-sm text-muted">kcal</span>
          </div>
          <p className="text-xs text-muted">
            {perServing !== undefined && servings !== 1
              ? `${formatNumber(servings)} × ${formatNumber(perServing)} kcal = ${formatNumber(entryCalories)} kcal`
              : 'As printed on the label, for one serving.'}
          </p>
        </div>
        <NutrientsSection values={nutrients} onChange={setNutrients} disabled={pending} />
        {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" disabled={pending} onClick={close} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !complete} className={PRIMARY_BUTTON}>
            <PlusIcon className="size-5" />
            {complete ? `Add ${formatNumber(entryCalories)} kcal` : 'Add food'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
