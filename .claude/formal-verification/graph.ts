type Value = string | number | boolean | Value[]

export type Step = { action: string; state: Record<string, Value> }

const valueOf = (text: string): Value =>
  JSON.parse(
    text
      .replaceAll('<<', '[')
      .replaceAll('>>', ']')
      .replaceAll('TRUE', 'true')
      .replaceAll('FALSE', 'false'),
  ) as Value

const stateOf = (label: string): Step['state'] =>
  Object.fromEntries(
    label
      .replaceAll('\\n', '\n')
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\')
      .split('\n')
      .flatMap((line) => {
        const match = /^\/\\ (\w+) = (.*)$/.exec(line)
        return match?.[1] === undefined || match[2] === undefined
          ? []
          : [[match[1], valueOf(match[2])]]
      }),
  )

export const replayPlan = (dot: string): { paths: Step[][]; steps: number } => {
  const states = new Map<string, Step['state']>()
  for (const [, id = '', label = ''] of dot.matchAll(/^(-?\d+) \[label="((?:[^"\\]|\\.)*)"/gm)) {
    states.set(id, stateOf(label))
  }
  const edges = new Map<string, { to: string; action: string }[]>()
  for (const [, from = '', to = '', action = ''] of dot.matchAll(
    /^(-?\d+) -> (-?\d+) \[label="(\w+)"/gm,
  )) {
    if (action !== 'Done') edges.set(from, [...(edges.get(from) ?? []), { to, action }])
  }
  const start = /^(-?\d+) \[label=[^\n]*style = filled\]/m.exec(dot)?.[1]
  if (start === undefined) throw new Error('The state graph has no start state')

  const pathTo = new Map<string, Step[]>([[start, []]])
  const walks: { path: Step[]; end: string; first: boolean }[] = []
  for (const [from, path] of pathTo) {
    for (const { to, action } of edges.get(from) ?? []) {
      const next = [...path, { action, state: states.get(to) ?? {} }]
      const first = !pathTo.has(to)
      if (first) pathTo.set(to, next)
      walks.push({ path: next, end: to, first })
    }
  }
  return {
    paths: walks
      .filter(({ end, first }) => !first || (edges.get(end) ?? []).length === 0)
      .map(({ path }) => path),
    steps: walks.length,
  }
}
