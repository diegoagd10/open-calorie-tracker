import type { ReactNode } from 'react'

export const INPUT =
  'h-11 w-full min-w-0 rounded-xl border border-line bg-bg px-3.5 text-fg-soft disabled:cursor-not-allowed'

const BUTTON =
  'flex h-10 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed sm:w-auto'

export const PRIMARY_BUTTON = `${BUTTON} bg-accent text-on-accent hover:brightness-110 disabled:bg-disabled disabled:text-on-disabled disabled:hover:brightness-100`

export const SECONDARY_BUTTON = `${BUTTON} border border-line-strong bg-bg disabled:opacity-60`

export const DISABLED_BUTTON =
  'flex h-10 w-full items-center justify-center gap-2 rounded-full bg-disabled px-5 text-sm font-semibold text-on-disabled sm:w-auto'

type SectionProps = { id: string; title: string; description: string; children: ReactNode }

// On small screens the title sits above the card; on wide ones it heads the card.
export function Section({ id, title, description, children }: SectionProps) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-3 sm:gap-0 sm:overflow-hidden sm:rounded-[20px] sm:border sm:border-line sm:bg-surface"
    >
      <div className="flex flex-col gap-0.5 sm:border-b sm:border-line sm:px-5 sm:py-4">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <div className="rounded-[20px] border border-line bg-surface sm:rounded-none sm:border-0 sm:bg-transparent">
        {children}
      </div>
    </section>
  )
}
