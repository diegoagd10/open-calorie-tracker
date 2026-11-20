import { readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { type AriaRole, isAriaRole } from './roles.ts'

export const FLAGS = {
  'base-port': { type: 'string' },
  help: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  username: { type: 'string' },
  password: { type: 'string' },
  mobile: { type: 'boolean' },
  body: { type: 'string' },
  nth: { type: 'string' },
} as const
export type Flag = keyof typeof FLAGS

export type CommandName =
  | 'up'
  | 'doctor'
  | 'down'
  | 'login'
  | 'goto'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'press'
  | 'screenshot'
  | 'api'
// Every command also takes --base-port and --help.
export type Command = { usage: string; summary: string; flags?: readonly Flag[] }

// An element found by its ARIA role and accessible name, as getByRole finds it. nth picks one of
// several matches, from 0 in page order.
export type Target = { role: AriaRole; name: string; nth: number | undefined }
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type Method = (typeof METHODS)[number]

export type Request = { instance: Instance } & (
  | { command: 'up' | 'doctor' | 'snapshot' }
  | { command: 'down'; dryRun: boolean }
  | { command: 'login'; username: string | undefined; password: string | undefined }
  | { command: 'goto'; path: string }
  | { command: 'click'; target: Target }
  | { command: 'type'; target: Target; text: string }
  | { command: 'press'; key: string }
  | { command: 'screenshot'; path: string | undefined; mobile: boolean }
  | { command: 'api'; method: Method; path: string; body: unknown }
)

// Everything one --base-port N decides. An instance takes three consecutive ports.
export type Ports = { web: number; api: number; cdp: number }
export type Urls = { web: string; api: string; cdp: string }
export type Instance = {
  basePort: number
  ports: Ports
  urls: Urls
  dataDir: string
  stateFile: string
  evidenceDir: string
}

// A session id plus the start time of its leader, so a reused id is never mistaken for ours.
export type ProcessIdentity = { sid: number; startTime: string | undefined }
export type ProcessRecord = ProcessIdentity & { port: number; log: string }
export type ProcessName = 'api' | 'web' | 'browser'

// The contents of state.json, written by up and read by doctor and down.
export type State = {
  basePort: number
  repo: string
  dataDir: string
  evidenceDir: string
  webUrl: string
  apiUrl: string
  cdpUrl: string
  seedUser: { username: string; password: string }
  startedAt: string
  processes: Record<ProcessName, ProcessRecord>
}

export type Check = { name: string; ok: boolean; detail?: string; next?: string }

export const DEFAULT_BASE_PORT = 3300
const PORT_OFFSETS: Ports = { web: 0, api: 1, cdp: 2 }
const MIN_BASE_PORT = 1024
const MAX_BASE_PORT = 65_535 - Math.max(...Object.values(PORT_OFFSETS))

export const COMMANDS: Record<CommandName, Command> = {
  up: {
    usage: 'control-oct.ts up [--base-port N]',
    summary:
      'Builds the app, starts a seeded API, the web app and a headless Chromium on N, N+1 and N+2, and waits until they are usable. Reports and exits 0 when already up and healthy.',
  },
  doctor: {
    usage: 'control-oct.ts doctor [--base-port N]',
    summary:
      'Read-only. Checks the processes, port ownership, API, web app, seed user login and CDP endpoint of the instance on N.',
  },
  down: {
    usage: 'control-oct.ts down [--base-port N] [--dry-run]',
    summary:
      'Stops every process in the sessions that up started on N and removes its data dir. Keeps the evidence dir. --dry-run lists what it would do.',
    flags: ['dry-run'],
  },
  login: {
    usage: 'control-oct.ts login [--username U] [--password P] [--base-port N]',
    summary:
      'Clears the cookies and logs in through the /login form, as the seed user by default. Ends on the home page.',
    flags: ['username', 'password'],
  },
  goto: {
    usage: 'control-oct.ts goto <path> [--base-port N]',
    summary:
      'Opens a path of the web app, such as /settings, and waits until the network is quiet. Fails when it lands on /login without a session.',
  },
  snapshot: {
    usage: 'control-oct.ts snapshot [--base-port N]',
    summary:
      "Prints the page's URL, title, time zone, locale and accessibility tree, one line per node, as role and accessible name.",
  },
  click: {
    usage: 'control-oct.ts click <role> <name> [--nth I] [--base-port N]',
    summary:
      'Clicks the one element with this ARIA role and accessible name: an exact name first, else the one name that contains it. Lists candidates when none or several match. --nth I clicks the I-th of several matches, from 0 in page order.',
    flags: ['nth'],
  },
  type: {
    usage: 'control-oct.ts type <role> <name> <text> [--nth I] [--base-port N]',
    summary:
      "Replaces the value of the field with this role and name with text, like Playwright's fill. Finds the field the way click does, --nth included.",
    flags: ['nth'],
  },
  press: {
    usage: 'control-oct.ts press <key> [--base-port N]',
    summary:
      'Presses a key on the focused element, by Playwright key name: Enter, Escape, Tab, ArrowDown, Control+A.',
  },
  screenshot: {
    usage: 'control-oct.ts screenshot [path] [--mobile] [--base-port N]',
    summary:
      'Saves a PNG of the viewport, by default as <timestamp>.png in the evidence dir. --mobile shoots it at the phone size of the web tests, 390x844 at 3x with touch, then restores the page.',
    flags: ['mobile'],
  },
  api: {
    usage: 'control-oct.ts api <METHOD> <path> [--body JSON] [--base-port N]',
    summary:
      "Calls the API with the browser's session token, as the user login logged in, and prints the status and the parsed body. Exits 0 whatever the status.",
    flags: ['body'],
  },
}

export const isCommandName = (value: string): value is CommandName => Object.hasOwn(COMMANDS, value)

export class Failure extends Error {
  // What the agent should do instead.
  next: string
  // Extra fields for the output, such as the candidates for a target that was not found.
  details: Record<string, unknown>

  constructor(message: string, next: string, details: Record<string, unknown> = {}) {
    super(message)
    this.next = next
    this.details = details
  }
}

export const instanceAt = (basePort: number): Instance => {
  const port = (name: keyof Ports) => basePort + PORT_OFFSETS[name]
  const dataDir = join(tmpdir(), `oct-verify-${basePort}`)
  return {
    basePort,
    ports: { web: port('web'), api: port('api'), cdp: port('cdp') },
    urls: {
      web: `http://localhost:${port('web')}`,
      api: `http://localhost:${port('api')}`,
      cdp: `http://127.0.0.1:${port('cdp')}`,
    },
    dataDir,
    stateFile: join(dataDir, 'state.json'),
    evidenceDir: join(tmpdir(), `oct-verify-${basePort}-evidence`),
  }
}

// Parses the --base-port flag.
export const parseInstance = (value: string | undefined): Instance => {
  if (value === undefined) return instanceAt(DEFAULT_BASE_PORT)
  const basePort = Number(value)
  if (!Number.isInteger(basePort) || basePort < MIN_BASE_PORT || basePort > MAX_BASE_PORT) {
    throw new Failure(
      `--base-port must be an integer from ${MIN_BASE_PORT} to ${MAX_BASE_PORT}, got "${value}"`,
      `Pass --base-port ${DEFAULT_BASE_PORT}, or omit it`,
    )
  }
  return instanceAt(basePort)
}

export const newState = (
  instance: Instance,
  { repo, seedUser, processes }: Pick<State, 'repo' | 'seedUser' | 'processes'>,
): State => ({
  basePort: instance.basePort,
  repo,
  dataDir: instance.dataDir,
  evidenceDir: instance.evidenceDir,
  webUrl: instance.urls.web,
  apiUrl: instance.urls.api,
  cdpUrl: instance.urls.cdp,
  seedUser,
  startedAt: new Date().toISOString(),
  processes,
})

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const field = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined

const invalid = (): never => {
  throw new TypeError('invalid state')
}
const object = (value: unknown) => (isObject(value) ? value : invalid())
const string = (value: unknown) => (typeof value === 'string' ? value : invalid())
const integer = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : invalid()

const processRecord = (value: unknown): ProcessRecord => {
  const { sid, startTime, port, log } = object(value)
  return {
    sid: integer(sid),
    startTime: startTime === undefined ? undefined : string(startTime),
    port: integer(port),
    log: string(log),
  }
}

export const parseState = (text: string): State | undefined => {
  try {
    const {
      basePort,
      repo,
      dataDir,
      evidenceDir,
      webUrl,
      apiUrl,
      cdpUrl,
      seedUser,
      startedAt,
      processes,
    } = object(JSON.parse(text))
    const { username, password } = object(seedUser)
    const { api, web, browser } = object(processes)
    return {
      basePort: integer(basePort),
      repo: string(repo),
      dataDir: string(dataDir),
      evidenceDir: string(evidenceDir),
      webUrl: string(webUrl),
      apiUrl: string(apiUrl),
      cdpUrl: string(cdpUrl),
      seedUser: { username: string(username), password: string(password) },
      startedAt: string(startedAt),
      processes: {
        api: processRecord(api),
        web: processRecord(web),
        browser: processRecord(browser),
      },
    }
  } catch {
    return undefined
  }
}

export const readState = (instance: Instance): Promise<State | undefined> =>
  readFile(instance.stateFile, 'utf8').then(parseState, () => undefined)

export const writeState = async (state: State): Promise<void> => {
  const { stateFile } = instanceAt(state.basePort)
  await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${stateFile}.tmp`, stateFile)
}

const usage = (command: CommandName) => `See ${COMMANDS[command].usage}`

const parseNth = (command: CommandName, value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const nth = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(nth)) {
    throw new Failure(`--nth must be an integer from 0, got "${value}"`, usage(command))
  }
  return nth
}

const parseTarget = (
  command: CommandName,
  role: string,
  name: string,
  nth: string | undefined,
): Target => {
  if (!isAriaRole(role)) {
    throw new Failure(
      `"${role}" is not an ARIA role`,
      'Run snapshot: each line starts with a role, such as button, textbox, link, heading or dialog',
    )
  }
  if (name === '') throw new Failure(`${command} needs a non-empty <name>`, usage(command))
  return { role, name, nth: parseNth(command, nth) }
}

const parsePath = (command: CommandName, path: string): string => {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Failure(`<path> must start with one /, got "${path}"`, usage(command))
  }
  return path
}

const parseMethod = (value: string): Method => {
  const method = METHODS.find((m) => m === value.toUpperCase())
  if (method === undefined) {
    throw new Failure(`unknown method "${value}"`, `Use one of: ${METHODS.join(', ')}`)
  }
  return method
}

const parseBody = (value: string | undefined): unknown => {
  if (value === undefined) return undefined
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Failure(
      `--body is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      `Quote it for the shell, e.g. --body '{"amount": 8}'`,
    )
  }
}

// Parses the arguments after the command name. Returns undefined for --help.
export const parseRequest = (command: CommandName, args: string[]): Request | undefined => {
  let parsed
  try {
    parsed = parseArgs({ args, options: FLAGS, allowPositionals: true })
  } catch (error) {
    throw new Failure(error instanceof Error ? error.message : String(error), usage(command))
  }
  const { values, positionals } = parsed
  if (values.help) return undefined
  const allowed = new Set<string>(['base-port', 'help', ...(COMMANDS[command].flags ?? [])])
  const foreign = Object.keys(values).filter((flag) => !allowed.has(flag))
  if (foreign.length > 0) {
    throw new Failure(`${command} does not take --${foreign.join(', --')}`, usage(command))
  }
  const instance = parseInstance(values['base-port'])
  const wrongArity = () =>
    new Failure(`wrong arguments: ${JSON.stringify(positionals)}`, usage(command))
  const [first, second, third, ...extra] = positionals
  const none = first === undefined
  switch (command) {
    case 'up':
    case 'doctor':
    case 'snapshot':
      if (!none) throw wrongArity()
      return { instance, command }
    case 'down':
      if (!none) throw wrongArity()
      return { instance, command, dryRun: values['dry-run'] === true }
    case 'login':
      if (!none) throw wrongArity()
      return { instance, command, username: values.username, password: values.password }
    case 'goto':
      if (first === undefined || second !== undefined) throw wrongArity()
      return { instance, command, path: parsePath(command, first) }
    case 'click':
      if (first === undefined || second === undefined || third !== undefined) throw wrongArity()
      return { instance, command, target: parseTarget(command, first, second, values.nth) }
    case 'type':
      if (first === undefined || second === undefined || third === undefined || extra.length > 0) {
        throw wrongArity()
      }
      return {
        instance,
        command,
        target: parseTarget(command, first, second, values.nth),
        text: third,
      }
    case 'press':
      if (first === undefined || second !== undefined) throw wrongArity()
      return { instance, command, key: first }
    case 'screenshot':
      if (second !== undefined) throw wrongArity()
      return { instance, command, path: first, mobile: values.mobile === true }
    case 'api':
      if (first === undefined || second === undefined || third !== undefined) throw wrongArity()
      return {
        instance,
        command,
        method: parseMethod(first),
        path: parsePath(command, second),
        body: parseBody(values.body),
      }
  }
}
