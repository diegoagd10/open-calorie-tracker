'use client'

import { GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import Link from 'next/link'
import { Alert } from '@/components/alert'
import { AppHeader } from '@/components/app-header'
import { InfoIcon, KeyIcon, PlusIcon } from '@/components/icons'
import { useLogOut } from '@/components/use-log-out'
import { DailyGoalsSection } from './daily-goals'
import { DISABLED_BUTTON, INPUT, Section } from './section'

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

// Where the profile, daily goals and API keys are managed. Only the daily goals can be changed yet.
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
        <DailyGoalsSection />
        <ApiKeys />
      </main>
    </div>
  )
}
