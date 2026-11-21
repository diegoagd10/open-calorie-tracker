import type { CSSProperties } from 'react'
import { roundForDisplay } from './format'

const OVER_GOAL_COLOR = 'var(--danger)'

type ProgressBarProps = {
  label: string
  value: number
  goal: number
  color: string
  warnOverGoal?: boolean
  className?: string
}

export function ProgressBar({
  label,
  value,
  goal,
  color,
  warnOverGoal = true,
  className = 'h-1.5',
}: ProgressBarProps) {
  const overGoal = warnOverGoal && value > goal
  const rounded = roundForDisplay(value)

  return (
    <progress
      aria-label={label}
      aria-valuenow={rounded}
      aria-valuemin={0}
      aria-valuemax={goal}
      value={Math.min(rounded, goal)}
      max={goal}
      data-over-goal={overGoal}
      style={{ '--bar-color': overGoal ? OVER_GOAL_COLOR : color } as CSSProperties}
      className={`block w-full appearance-none overflow-hidden rounded-full bg-track [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-(--bar-color) [&::-webkit-progress-bar]:bg-track [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-(--bar-color) ${className}`}
    />
  )
}
