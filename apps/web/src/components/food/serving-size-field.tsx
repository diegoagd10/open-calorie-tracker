import {
  MAX_SERVING_SIZE_LENGTH,
  type ServingSize,
  normalizeServingSize,
} from '@open-calorie-tracker/shared'
import { type ReactNode, useId } from 'react'
import { CheckIcon, ChevronIcon, PlusIcon } from '@/components/icons'

// How many of the user's serving sizes the list shows at once.
const MAX_MATCHES = 5

const lower = (text: string) => normalizeServingSize(text).toLowerCase()

// The user's serving size the text names regardless of case, if any.
export const findServingSize = (servingSizes: ServingSize[], text: string) =>
  servingSizes.find((servingSize) => lower(servingSize.name) === lower(text))

const byName = (a: ServingSize, b: ServingSize) =>
  a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1

type ServingSizeFieldProps = {
  value: string
  onChange: (value: string) => void
  servingSizes: ServingSize[]
  // Whether the list may show; it only does once something is typed.
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  // Shown next to the field, e.g. the servings.
  aside: ReactNode
}

// A combobox over the user's serving sizes: typing filters them and offers to create the text
// typed, which is saved when the food is added.
export function ServingSizeField({
  value,
  onChange,
  servingSizes,
  open,
  onOpenChange,
  disabled,
  aside,
}: ServingSizeFieldProps) {
  const id = useId()
  const listId = useId()
  const query = normalizeServingSize(value)
  const exact = findServingSize(servingSizes, value)
  const matches = servingSizes
    .filter((servingSize) => servingSize.name.toLowerCase().includes(query.toLowerCase()))
    .sort(byName)
    .slice(0, MAX_MATCHES)
  const listShown = open && query !== ''

  const pick = (name: string) => {
    onChange(name)
    onOpenChange(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Serving size
          </label>
          <div
            className={`flex h-12 items-center gap-2 rounded-xl border bg-bg pr-3 pl-3.5 ${
              listShown ? 'border-accent' : 'border-line-strong'
            }`}
          >
            <input
              id={id}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={listShown}
              aria-controls={listId}
              autoComplete="off"
              placeholder="Search or create"
              maxLength={MAX_SERVING_SIZE_LENGTH}
              disabled={disabled}
              value={value}
              onChange={(event) => {
                onChange(event.target.value.slice(0, MAX_SERVING_SIZE_LENGTH))
                onOpenChange(true)
              }}
              onFocus={() => onOpenChange(true)}
              className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted"
            />
            <ChevronIcon direction="down" className="size-4 shrink-0 text-muted" />
          </div>
        </div>
        {aside}
      </div>
      {listShown && (
        // The fieldset only groups; it doesn't stretch or scroll its content well, so the box is a div.
        <fieldset id={listId} aria-label="Serving sizes" className="m-0 min-w-0 border-0 p-0">
          <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-line-strong bg-bg p-1.5">
            <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted">
              {matches.length === 0 ? 'No saved serving size matches' : 'Matching serving sizes'}
            </p>
            {matches.map((servingSize) => {
              const selected = servingSize.id === exact?.id
              return (
                <button
                  key={servingSize.id}
                  type="button"
                  onClick={() => pick(servingSize.name)}
                  className={`flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-left ${
                    selected ? 'bg-food-soft' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1">{servingSize.name}</span>
                  {selected && <CheckIcon label="Selected" className="size-[18px] text-accent" />}
                </button>
              )
            })}
            {exact === undefined && (
              <button
                type="button"
                onClick={() => pick(query)}
                className="flex min-h-12 items-center gap-2.5 rounded-b-[10px] border-t border-line px-2.5 py-1 text-left text-accent-text"
              >
                <PlusIcon className="size-[18px] shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">Create “{query}”</span>
                  <span className="text-xs text-muted">
                    Saved to your serving sizes when you add this food
                  </span>
                </span>
              </button>
            )}
          </div>
        </fieldset>
      )}
      {query !== '' && exact === undefined && !listShown && (
        <p className="text-xs text-accent-text">
          New serving size · it will be saved when you add this food
        </p>
      )}
    </div>
  )
}
