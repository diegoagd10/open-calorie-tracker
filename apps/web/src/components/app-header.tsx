import Link from 'next/link'
import type { ReactNode } from 'react'
import { ForkKnifeIcon, GearIcon, TrendDownIcon } from '@/components/icons'
import { Logo } from '@/components/logo'
import type { useLogOut } from '@/components/use-log-out'

const ICON_LINK =
  'flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg-soft aria-[current=page]:bg-surface-selected aria-[current=page]:text-fg'

// The header's icon links, named for screen readers. `current` marks the page being shown.
export function FoodLogLink() {
  return (
    <Link href="/" aria-label="Food Log" className={ICON_LINK}>
      <ForkKnifeIcon className="size-[18px]" />
    </Link>
  )
}

export function WeightLink({ current = false }: { current?: boolean }) {
  return (
    <Link
      href="/weight"
      aria-label="Weight"
      aria-current={current ? 'page' : undefined}
      className={ICON_LINK}
    >
      <TrendDownIcon className="size-[18px]" />
    </Link>
  )
}

export function SettingsLink() {
  return (
    <Link href="/settings" aria-label="Settings" className={ICON_LINK}>
      <GearIcon className="size-[18px]" />
    </Link>
  )
}

type AppHeaderProps = {
  // The links to the other pages, shown before Log out.
  children: ReactNode
  logOut: ReturnType<typeof useLogOut>
}

// The header of every page that needs a session.
export function AppHeader({ children, logOut }: AppHeaderProps) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3.5 sm:gap-4 sm:px-8">
        <Logo size="small" />
        <nav aria-label="Main" className="flex shrink-0 items-center gap-1 sm:gap-2">
          {children}
          <button
            type="button"
            disabled={logOut.pending}
            onClick={() => void logOut.logOut()}
            className="flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-sm whitespace-nowrap sm:px-4 font-semibold disabled:opacity-60"
          >
            Log out
          </button>
        </nav>
      </div>
    </header>
  )
}
