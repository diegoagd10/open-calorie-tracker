'use client'

import type { WaterLogEntry } from '@open-calorie-tracker/shared'
import { useState } from 'react'
import { DeleteWaterDialog, WaterDialog } from './water-dialog'

// Adding, or editing an entry and maybe confirming its deletion.
type OpenDialog = { mode: 'add' } | { mode: 'edit'; entry: WaterLogEntry; deleting: boolean }

// The water dialogs a page can open. `dialogs` renders whichever is open; once the log changes
// they close and `onChanged` runs, e.g. to reload the log.
export const useWaterDialogs = (onChanged: () => void) => {
  const [open, setOpen] = useState<OpenDialog>()

  const close = () => setOpen(undefined)
  const changed = () => {
    close()
    onChanged()
  }

  const dialogs = (
    <>
      {open?.mode === 'add' && <WaterDialog onClose={close} onChanged={changed} />}
      {open?.mode === 'edit' && (
        <>
          <WaterDialog
            entry={open.entry}
            onClose={close}
            onChanged={changed}
            onDelete={() => setOpen({ ...open, deleting: true })}
          />
          {open.deleting && (
            <DeleteWaterDialog
              entry={open.entry}
              onCancel={() => setOpen({ ...open, deleting: false })}
              onDeleted={changed}
            />
          )}
        </>
      )}
    </>
  )

  return {
    add: () => setOpen({ mode: 'add' }),
    edit: (entry: WaterLogEntry) => setOpen({ mode: 'edit', entry, deleting: false }),
    dialogs,
  }
}
