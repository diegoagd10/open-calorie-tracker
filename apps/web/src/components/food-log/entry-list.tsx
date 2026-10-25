import type { LogEntry } from '@open-calorie-tracker/shared'
import { ChevronIcon, DropIcon, ForkKnifeIcon } from '@/components/icons'
import { formatNumber, formatTime } from './format'

const SOURCE_LABELS = { manual: 'Manual' } as const

function EntryIcon({ type }: { type: LogEntry['type'] }) {
  return type === 'food' ? (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-food-soft text-accent-text">
      <ForkKnifeIcon label="Food" className="size-5" />
    </span>
  ) : (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-water-soft text-water">
      <DropIcon label="Water" className="size-5" />
    </span>
  )
}

function Entry({ entry }: { entry: LogEntry }) {
  return (
    <li className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3">
      <EntryIcon type={entry.type} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{formatTime(entry.loggedAt)}</p>
        {entry.type === 'food' ? (
          <>
            <p className="truncate font-semibold">{entry.name}</p>
            <p className="text-xs text-muted">{SOURCE_LABELS[entry.source]}</p>
            <p className="text-xs text-muted">
              {entry.servingSize} × {formatNumber(entry.quantity)}
            </p>
          </>
        ) : (
          <p className="font-semibold">Water</p>
        )}
      </div>
      {entry.type === 'food' ? (
        <p className="text-right">
          <span className="block font-serif text-[22px] leading-tight">
            {formatNumber(entry.calories)}
          </span>
          <span className="block text-xs text-muted">kcal</span>
        </p>
      ) : (
        <p className="font-serif text-[22px] leading-tight">{formatNumber(entry.amount)} fl oz</p>
      )}
      <ChevronIcon direction="right" className="size-4 shrink-0 text-muted" />
    </li>
  )
}

export function EntryList({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
        <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-surface">
          <span className="size-4 rounded-sm border-2 border-fg" />
        </span>
        <p className="font-semibold">No entries for this day</p>
        <p className="text-sm text-fg-soft">Add food or water when you&apos;re ready.</p>
      </div>
    )
  }

  return (
    <ul aria-label="Entries" className="flex flex-col gap-2">
      {entries.map((entry) => (
        <Entry key={`${entry.type}-${entry.id}`} entry={entry} />
      ))}
    </ul>
  )
}
