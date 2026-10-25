'use client'

import { type ReactNode, useEffect, useRef } from 'react'

type ModalProps = {
  labelledBy: string
  // alertdialog for confirmations.
  role?: 'dialog' | 'alertdialog'
  // Called on Escape and on a click outside the dialog.
  onDismiss: () => void
  children: ReactNode
}

// A native modal dialog: it traps focus, closes on Escape and leaves the page behind it inert.
// Small screens show it as a bottom sheet; wide ones center it.
export function Modal({ labelledBy, role = 'dialog', onDismiss, children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return (
    // The dialog itself only receives clicks on its backdrop, since its content fills it. Escape
    // is the keyboard's way out, handled by onCancel.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      role={role}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
      className="mx-0 mt-auto mb-0 w-full max-w-none rounded-t-[24px] border border-line bg-surface p-0 text-fg backdrop:bg-black/50 sm:m-auto sm:max-w-md sm:rounded-[24px]"
    >
      <div className="flex flex-col gap-5 px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
        {children}
      </div>
    </dialog>
  )
}
