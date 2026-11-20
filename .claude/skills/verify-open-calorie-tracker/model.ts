import { readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type CommandName = 'up' | 'doctor' | 'down'
export type Command = { usage: string; summary: string }

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
  },
}

export const isCommandName = (value: string): value is CommandName => Object.hasOwn(COMMANDS, value)

export class Failure extends Error {
  // What the agent should do instead.
  next: string

  constructor(message: string, next: string) {
    super(message)
    this.next = next
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
