import type { WeightGoal, WeightHistory } from '@open-calorie-tracker/shared'
import { formatShortDay, parseDay } from '@/components/food-log/format'

const WIDTH = 640
const HEIGHT = 220
const PADDING = { left: 36, right: 10, top: 10, bottom: 10 }
const GRID_STEP = 5

const dayNumber = (date: string) => parseDay(date).getTime() / (24 * 60 * 60 * 1000)

type WeightChartProps = { entries: WeightHistory['entries']; goal: WeightGoal | null }

// The weigh-ins as points, their 7-day trend as a line and, with a goal, its starting and goal
// weights as dashed lines. The dates span the weigh-ins shown, not the whole period.
export function WeightChart({ entries, goal }: WeightChartProps) {
  const weights = entries.flatMap(({ weight, trend }) => [weight, trend])
  if (goal !== null) weights.push(goal.startWeight, goal.goalWeight)
  const top = Math.ceil((Math.max(...weights) + 1) / GRID_STEP) * GRID_STEP
  const bottom = Math.floor((Math.min(...weights) - 1) / GRID_STEP) * GRID_STEP
  const first = entries[0]?.date ?? ''
  const last = entries.at(-1)?.date ?? first
  const span = dayNumber(last) - dayNumber(first)

  const x = (date: string) => {
    const plotWidth = WIDTH - PADDING.left - PADDING.right
    // A single day sits in the middle.
    const share = span === 0 ? 0.5 : (dayNumber(date) - dayNumber(first)) / span
    return PADDING.left + plotWidth * share
  }
  const y = (weight: number) =>
    PADDING.top + ((HEIGHT - PADDING.top - PADDING.bottom) * (top - weight)) / (top - bottom)

  const grid: number[] = []
  for (let weight = bottom; weight <= top; weight += GRID_STEP) grid.push(weight)

  const guide = (kind: 'goal' | 'start', weight: number, color: string, dash: string) => (
    <line
      data-line={kind}
      x1={PADDING.left}
      x2={WIDTH - PADDING.right}
      y1={y(weight)}
      y2={y(weight)}
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray={dash}
    />
  )

  return (
    // One image for screen readers; an <img> cannot hold a drawn SVG and its HTML date labels.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <div role="img" aria-label="Weight chart" className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full">
        {grid.map((weight) => (
          <g key={weight}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(weight)}
              y2={y(weight)}
              stroke="var(--line)"
            />
            <text
              x={PADDING.left - 6}
              y={y(weight) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--muted)"
            >
              {weight}
            </text>
          </g>
        ))}
        {goal !== null && guide('start', goal.startWeight, 'var(--muted)', '2 4')}
        {goal !== null && guide('goal', goal.goalWeight, 'var(--accent)', '6 4')}
        {entries.map(({ date, weight }) => (
          <circle
            key={date}
            data-point
            data-date={date}
            cx={x(date)}
            cy={y(weight)}
            r={3}
            fill="var(--water)"
            opacity={0.55}
          />
        ))}
        <polyline
          data-line="trend"
          fill="none"
          stroke="var(--water)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={entries.map(({ date, trend }) => `${x(date)},${y(trend)}`).join(' ')}
        />
      </svg>
      <p
        className="flex justify-between text-xs text-muted"
        style={{
          paddingLeft: `${(PADDING.left / WIDTH) * 100}%`,
          paddingRight: `${(PADDING.right / WIDTH) * 100}%`,
        }}
      >
        <span data-axis="start">{formatShortDay(parseDay(first))}</span>
        <span data-axis="end">{formatShortDay(parseDay(last))}</span>
      </p>
    </div>
  )
}
