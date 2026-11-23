export const ACTIONS = [
  'ArriveWrong',
  'ArriveRight',
  'RefuseLocked',
  'RefuseFull',
  'WrongCounted',
  'WrongLocks',
  'RightConfirmed',
  'CheckThrows',
  'LockRunsOut',
  'Done',
] as const

export type Action = (typeof ACTIONS)[number]

type Edge = { to: string; action: Action }

const isAction = (value: string | undefined): value is Action =>
  ACTIONS.some((action) => action === value)

export const pathsThroughEveryStep = (dot: string): Action[][] => {
  const edges = new Map<string, Edge[]>()
  for (const [, from = '', to = '', label] of dot.matchAll(
    /^(-?\d+) -> (-?\d+) \[label="(\w+)"/gm,
  )) {
    if (!isAction(label)) throw new Error(`The model has an unknown action ${label}`)
    edges.set(from, [...(edges.get(from) ?? []), { to, action: label }])
  }
  const start = /^(-?\d+) \[label=[^\n]*style = filled\]/m.exec(dot)?.[1]
  if (start === undefined) throw new Error('The state graph has no start state')

  const pathTo = new Map<string, Action[]>([[start, []]])
  const paths: Action[][] = []
  for (const [state, path] of pathTo) {
    for (const { to, action } of edges.get(state) ?? []) {
      const next = [...path, action]
      if (action !== 'Done') paths.push(next)
      if (!pathTo.has(to)) pathTo.set(to, next)
    }
  }
  return paths
}
