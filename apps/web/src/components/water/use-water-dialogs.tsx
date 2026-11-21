'use client'

import type { WaterLogEntry } from '@open-calorie-tracker/shared'
import { useState } from 'react'
import { AddWaterDialog } from './add-water-dialog'
import { DeleteWaterDialog } from './delete-water-dialog'
import { EditWaterDialog } from './edit-water-dialog'

type OpenDialog = { mode: 'add' } | { mode: 'edit'; entry: WaterLogEntry; deleting: boolean }

type WaterDialogsOptions = {
  day: string | undefined
  isToday: boolean
  total: number
  goal: number
  onChanged: () => void
}

export const useWaterDialogs = ({ day, isToday, total, goal, onChanged }: WaterDialogsOptions) => {
  const [open, setOpen] = useState<OpenDialog>()

  const close = () => setOpen(undefined)
  const changed = () => {
    close()
    onChanged()
  }

  const dialogs = (
    <>
      {open?.mode === 'add' && (
        <AddWaterDialog
          day={day}
          isToday={isToday}
          total={total}
          goal={goal}
          onClose={close}
          onAdded={changed}
        />
      )}
      {open?.mode === 'edit' && (
        <>
          <EditWaterDialog
            isToday={isToday}
            entry={open.entry}
            total={total}
            onClose={close}
            onChanged={changed}
            onDelete={() => setOpen({ ...open, deleting: true })}
          />
          {open.deleting && (
            <DeleteWaterDialog
              isToday={isToday}
              entry={open.entry}
              total={total}
              goal={goal}
              onKeep={() => setOpen({ ...open, deleting: false })}
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
