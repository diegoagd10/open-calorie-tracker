'use client'

import { GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import Link from 'next/link'
import { useState } from 'react'
import { Alert } from '@/components/alert'
import { AppHeader } from '@/components/app-header'
import { CheckIcon } from '@/components/icons'
import { useLogOut } from '@/components/use-log-out'
import { ApiKeysSection } from './api-keys/api-keys-section'
import { ChangePasswordDialog } from './change-password-dialog'
import { DailyGoalsSection } from './daily-goals'
import { INPUT, SECONDARY_BUTTON, Section } from './section'
import { useProfile } from './use-profile'

// The username is shown but cannot be changed; the password can be changed from a dialog.
function Profile() {
  const { profile, failed } = useProfile()
  const [dialogOpen, setDialogOpen] = useState(false)
  // Until the dialog opens again or the page reloads.
  const [changed, setChanged] = useState(false)

  const openDialog = () => {
    setChanged(false)
    setDialogOpen(true)
  }

  return (
    <Section id="profile" title="Profile" description="Your username and password.">
      {failed && (
        <div className="px-4 pt-4 sm:px-5">
          <Alert>{GENERIC_ERROR_MESSAGE}</Alert>
        </div>
      )}
      <div className="flex flex-col gap-1.5 p-4 sm:p-5">
        <label htmlFor="username" className="text-sm font-medium">
          Username
        </label>
        <input
          id="username"
          type="text"
          disabled
          value={profile?.username ?? ''}
          className={`${INPUT} sm:max-w-xs`}
        />
      </div>
      <div className="mx-4 flex flex-col gap-3 border-t border-line py-4 sm:mx-5 sm:flex-row sm:items-center sm:justify-between sm:py-5">
        <div>
          <p className="text-sm font-medium">Password</p>
          <output aria-live="polite" className="block text-sm text-muted">
            {changed ? (
              <span className="flex items-center gap-1.5 text-accent-text">
                <CheckIcon className="size-4 shrink-0" />
                Password changed.
              </span>
            ) : (
              'Used to log in on this server.'
            )}
          </output>
        </div>
        <button type="button" onClick={openDialog} className={SECONDARY_BUTTON}>
          Change password
        </button>
      </div>
      {dialogOpen && (
        <ChangePasswordDialog
          onClose={() => setDialogOpen(false)}
          onChanged={() => {
            setDialogOpen(false)
            setChanged(true)
          }}
        />
      )}
    </Section>
  )
}

// Where the profile, daily goals and API keys are managed.
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
        <h1 className="font-serif text-[40px] leading-none tracking-tight sm:text-5xl">Settings</h1>
        {logOut.failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <Profile />
        <DailyGoalsSection />
        <ApiKeysSection />
      </main>
    </div>
  )
}
