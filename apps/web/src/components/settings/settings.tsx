'use client'

import { DEFAULT_DAILY_GOALS, GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Alert } from '@/components/alert'
import { AppHeader } from '@/components/app-header'
import { GOALS } from '@/components/goals'
import { InfoIcon, KeyIcon, PlusIcon } from '@/components/icons'
import { useLogOut } from '@/components/use-log-out'

const INPUT =
  'h-11 w-full min-w-0 rounded-xl border border-line bg-bg px-3.5 text-fg-soft disabled:cursor-not-allowed'

const DISABLED_BUTTON =
  'flex h-10 w-full items-center justify-center gap-2 rounded-full bg-disabled px-5 text-sm font-semibold text-on-disabled sm:w-auto'

type SectionProps = { id: string; title: string; description: string; children: ReactNode }

// On small screens the title sits above the card; on wide ones it heads the card.
function Section({ id, title, description, children }: SectionProps) {
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

function Profile() {
  return (
    <Section id="profile" title="Profile" description="Your username and password.">
      <div className="flex flex-col gap-1.5 p-4 sm:p-5">
        <label htmlFor="username" className="text-sm font-medium">
          Username
        </label>
        <input id="username" type="text" disabled className={`${INPUT} sm:max-w-xs`} />
      </div>
      <div className="mx-4 flex flex-col gap-3 border-t border-line py-4 sm:mx-5 sm:flex-row sm:items-center sm:justify-between sm:py-5">
        <div>
          <p className="text-sm font-medium">Password</p>
          <p className="text-sm text-muted">Used to log in on this server.</p>
        </div>
        <button type="button" disabled className={DISABLED_BUTTON}>
          Change password
        </button>
      </div>
    </Section>
  )
}

function DailyGoals() {
  return (
    <Section
      id="daily-goals"
      title="Daily goals"
      description="The targets the Food Log measures each day against."
    >
      <form aria-label="Daily goals" onSubmit={(event) => event.preventDefault()}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-4 sm:grid-cols-4 sm:p-5">
          {GOALS.map(({ key, label, unit, color }) => (
            <div key={key} className="flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor={`goal-${key}`}
                className="flex items-center gap-2 text-sm font-medium"
              >
                <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
                {label}
              </label>
              <div className="relative">
                <input
                  id={`goal-${key}`}
                  type="text"
                  inputMode="numeric"
                  disabled
                  defaultValue={DEFAULT_DAILY_GOALS[key]}
                  aria-describedby={`goal-${key}-unit`}
                  className={`${INPUT} pr-12`}
                />
                <span
                  id={`goal-${key}-unit`}
                  className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-muted"
                >
                  {unit}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-line p-4 sm:px-5">
          <button type="submit" disabled className={DISABLED_BUTTON}>
            Save
          </button>
        </div>
      </form>
    </Section>
  )
}

function ApiKeys() {
  return (
    <Section
      id="api-keys"
      title="API keys"
      description="Keys for connecting other apps to your account."
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-8">
          <span className="flex size-10 items-center justify-center rounded-full bg-bg text-muted">
            <KeyIcon className="size-5" />
          </span>
          <p className="font-semibold">No API keys yet</p>
          <button type="button" disabled className={DISABLED_BUTTON}>
            <PlusIcon className="size-4" />
            Create API key
          </button>
        </div>
      </div>
    </Section>
  )
}

// Where the profile, daily goals and API keys will be managed. Nothing can be changed yet, so the
// page shows the default goals and sends nothing to the API.
export function Settings() {
  const logOut = useLogOut()

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <AppHeader logOut={logOut}>
        <Link
          href="/"
          className="flex h-9 items-center px-1.5 text-sm font-semibold whitespace-nowrap sm:px-3"
        >
          Food Log
        </Link>
      </AppHeader>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-[40px] leading-none tracking-tight sm:text-5xl">
            Settings
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted">
            <InfoIcon className="size-4 shrink-0" />
            Changing these settings isn’t available yet.
          </p>
        </div>
        {logOut.failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <Profile />
        <DailyGoals />
        <ApiKeys />
      </main>
    </div>
  )
}
