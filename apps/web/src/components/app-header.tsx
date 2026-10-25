import type { ReactNode } from 'react'
import { Logo } from '@/components/logo'
import type { useLogOut } from '@/components/use-log-out'

type AppHeaderProps = {
  // The link to the other page, shown before Log out.
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
