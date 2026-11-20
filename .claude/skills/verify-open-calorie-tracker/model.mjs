import { readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @typedef {'up' | 'doctor' | 'down'} CommandName
 * @typedef {{ usage: string, summary: string }} Command
 *
 * Everything one --base-port N decides. An instance takes three consecutive ports.
 * @typedef {{ web: number, api: number, cdp: number }} Ports
 * @typedef {{ web: string, api: string, cdp: string }} Urls
 * @typedef {{
 *   basePort: number,
 *   ports: Ports,
 *   urls: Urls,
 *   dataDir: string,
 *   stateFile: string,
 *   evidenceDir: string,
 * }} Instance
 *
 * A session id plus the start time of its leader, so a reused id is never mistaken for ours.
 * @typedef {{ sid: number, startTime: string | undefined }} ProcessIdentity
 * @typedef {ProcessIdentity & { port: number, log: string }} ProcessRecord
 * @typedef {'api' | 'web' | 'browser'} ProcessName
 *
 * The contents of state.json, written by up and read by doctor and down.
 * @typedef {{
 *   basePort: number,
 *   repo: string,
 *   dataDir: string,
 *   evidenceDir: string,
 *   webUrl: string,
 *   apiUrl: string,
 *   cdpUrl: string,
 *   seedUser: { username: string, password: string },
 *   startedAt: string,
 *   processes: Record<ProcessName, ProcessRecord>,
 * }} State
 *
 * @typedef {{ name: string, ok: boolean, detail?: string, next?: string }} Check
 */

export const DEFAULT_BASE_PORT = 3300
const PORT_OFFSETS = { web: 0, api: 1, cdp: 2 }
const MIN_BASE_PORT = 1024
const MAX_BASE_PORT = 65_535 - Math.max(...Object.values(PORT_OFFSETS))

/** @type {Record<CommandName, Command>} */
export const COMMANDS = {
  up: {
    usage: 'control-oct.mjs up [--base-port N]',
    summary:
      'Builds the app, starts a seeded API, the web app and a headless Chromium on N, N+1 and N+2, and waits until they are usable. Reports and exits 0 when already up and healthy.',
  },
  doctor: {
    usage: 'control-oct.mjs doctor [--base-port N]',
    summary:
      'Read-only. Checks the processes, port ownership, API, web app, seed user login and CDP endpoint of the instance on N.',
  },
  down: {
    usage: 'control-oct.mjs down [--base-port N] [--dry-run]',
    summary:
      'Stops every process in the sessions that up started on N and removes its data dir. Keeps the evidence dir. --dry-run lists what it would do.',
  },
}

export class Failure extends Error {
  /** @param {string} message @param {string} next what the agent should do instead */
  constructor(message, next) {
    super(message)
    this.next = next
  }
}

/** @returns {Instance} */
export const instanceAt = (basePort) => {
  const port = (name) => basePort + PORT_OFFSETS[name]
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

/** Parses the --base-port flag. @returns {Instance} */
export const parseInstance = (value) => {
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

/** @param {Instance} instance @returns {State} */
export const newState = (instance, { repo, seedUser, processes }) => ({
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

/** @param {Instance} instance @returns {Promise<State | undefined>} */
export const readState = async (instance) => {
  try {
    return JSON.parse(await readFile(instance.stateFile, 'utf8'))
  } catch {
    return undefined
  }
}

/** @param {State} state */
export const writeState = async (state) => {
  const { stateFile } = instanceAt(state.basePort)
  await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${stateFile}.tmp`, stateFile)
}
