const SIZES = {
  small: {
    layout: 'flex-row gap-2.5',
    mark: 'size-8 rounded-[10px] text-[13px]',
    name: 'text-fg-soft',
  },
  large: {
    layout: 'flex-col gap-3',
    mark: 'size-12 rounded-[14px] text-[17px]',
    name: 'text-muted',
  },
}

// The app's mark followed by its name, shown on every page.
export function Logo({ size }: { size: keyof typeof SIZES }) {
  const { layout, mark, name } = SIZES[size]

  return (
    <div className={`flex items-center ${layout}`}>
      <span
        aria-hidden="true"
        className={`flex items-center justify-center bg-accent font-semibold text-on-accent ${mark}`}
      >
        OC
      </span>
      <p className={`text-sm font-medium ${name}`}>Open Calorie Tracker</p>
    </div>
  )
}
