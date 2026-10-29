'use client'

import {
  type FoodEntryInput,
  type FoodLogEntry,
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
import { loggedAtOnDay } from '@/components/food-log/selected-day'
import { ForkKnifeIcon, MinusIcon, PlusIcon, TrashIcon } from '@/components/icons'
import { Modal } from '@/components/modal'
import type { Outcome } from '@/components/requests'
import { useSubmission } from '@/components/use-submission'
import { addFood, loadServingSizes, saveServingSize, updateFood } from './food-requests'
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

type FoodDialogProps = {
  day: string | undefined
  isToday: boolean
  // The entry to edit; without one the dialog adds a food.
  entry?: FoodLogEntry
  // Today's calories so far, including the entry, and the daily goal, in kcal.
  total: number
  goal: number
  onClose: () => void
  // Called once the food is saved, or the entry turned out to be gone.
  onSaved: () => void
  // Asks to delete the entry; only an entry being edited offers it.
  onDelete?: () => void
}

// "Add food" or "Save" until the form is complete, then the calories it saves.
const submitLabel = (adding: boolean, complete: boolean, calories: number) => {
  if (!complete) return adding ? 'Add food' : 'Save'
  return `${adding ? 'Add' : 'Save'} ${formatNumber(calories)} kcal`
}

// A stored total, per serving again: 270 kcal over 1.5 servings is "180".
const perServingText = (total: number | null, servings: number) =>
  total === null ? '' : String(roundTenths(total / servings))

// Logs a food as its label prints it, per serving, times the servings eaten, or edits a logged one.
// Shows where the food would bring today's calories.
export function FoodDialog({
  day,
  isToday,
  entry,
  total,
  goal,
  onClose,
  onSaved,
  onDelete,
}: FoodDialogProps) {
  const titleId = useId()
  const nameId = useId()
  const caloriesId = useId()
  const servingsLabelId = useId()
  // What the entry holds, per serving, as the form shows it.
  const [initial] = useState(() =>
    entry === undefined
      ? { name: '', servingSize: '', servings: 1, calories: '', nutrients: NO_NUTRIENTS }
      : {
          name: entry.name,
          servingSize: entry.servingSize,
          servings: entry.quantity,
          calories: perServingText(entry.calories, entry.quantity),
          nutrients: Object.fromEntries(
            NUTRIENT_FIELDS.map(({ key }) => [key, perServingText(entry[key], entry.quantity)]),
          ) as NutrientValues,
        },
  )
  const [name, setName] = useState(initial.name)
  const [servingSize, setServingSize] = useState(initial.servingSize)
  const [servingSizes, setServingSizes] = useState<ServingSize[]>([])
  const [listOpen, setListOpen] = useState(false)
  const [servings, setServings] = useState(initial.servings)
  const [calories, setCalories] = useState(initial.calories)
  const [nutrients, setNutrients] = useState<NutrientValues>(initial.nutrients)
  const { pending, failed, submit } = useSubmission(onSaved)

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
  // Today without the entry being edited, which the new calories replace.
  const others = roundTenths(total - (entry?.calories ?? 0))
  const after = roundTenths(others + entryCalories)
  const over = after > goal
  const complete =
    name.trim() !== '' && normalizeServingSize(servingSize) !== '' && perServing !== undefined
  // Whether the form says what the entry already holds, ignoring spaces around the text and the
  // case of the serving size.
  const unchanged =
    entry !== undefined &&
    name.trim() === initial.name &&
    normalizeServingSize(servingSize).toLowerCase() === initial.servingSize.toLowerCase() &&
    servings === initial.servings &&
    perServing === perServingValue(initial.calories) &&
    NUTRIENT_FIELDS.every(
      ({ key }) => perServingValue(nutrients[key]) === perServingValue(initial.nutrients[key]),
    )

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
    const input: FoodEntryInput = {
      name: name.trim(),
      servingSizeId: chosen.id,
      quantity: servings,
      calories: perServing ?? 0,
    }
    for (const { key } of NUTRIENT_FIELDS) {
      const value = perServingValue(nutrients[key])
      if (value !== undefined) input[key] = value
    }
    return entry === undefined
      ? addFood({ ...input, ...(day === undefined ? {} : { loggedAt: loggedAtOnDay(day) }) })
      : updateFood(entry.id, input)
  }

  return (
    <Modal labelledBy={titleId} onDismiss={close}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!complete) return
          // Nothing changed, so there is nothing to send.
          if (unchanged) onClose()
          else void submit(save)
        }}
      >
        <DialogHeader
          titleId={titleId}
          title={entry === undefined ? 'Add food' : 'Edit food'}
          subtitle={
            entry === undefined
              ? `${formatNumber(total)} of ${formatNumber(goal)} kcal${isToday ? ' today' : ''} · ${goalStatus(total, goal)}`
              : entry.name
          }
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
            from={others}
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
              {/* The fieldset only groups; it doesn't stretch its content, so the pill is a div. */}
              <fieldset aria-labelledby={servingsLabelId} className="m-0 min-w-0 border-0 p-0">
                <div className="flex h-12 items-center rounded-full border border-line-strong bg-bg">
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
                </div>
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
        <div
          className={`grid items-center gap-2 ${onDelete === undefined ? 'grid-cols-[auto_1fr]' : 'grid-cols-[auto_auto_1fr]'}`}
        >
          {onDelete !== undefined && (
            <button
              type="button"
              disabled={pending}
              onClick={onDelete}
              className="flex h-12 items-center gap-2 px-1 font-semibold text-danger-text disabled:opacity-60"
            >
              <TrashIcon className="size-5" />
              Delete
            </button>
          )}
          <button type="button" disabled={pending} onClick={close} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !complete} className={PRIMARY_BUTTON}>
            {entry === undefined && <PlusIcon className="size-5" />}
            {submitLabel(entry === undefined, complete, entryCalories)}
          </button>
        </div>
      </form>
    </Modal>
  )
}
