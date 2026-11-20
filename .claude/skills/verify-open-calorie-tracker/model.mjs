import { readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @typedef {'up' | 'doctor' | 'down'} CommandName
 * @typedef {{ usage: string, summary: string }} Command
 *
 * @typedef {{ dataDir: string, stateFile: string, evidenceDir: string }} Paths
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

/** @returns {number} */
export const parseBasePort = (value) => {
  if (value === undefined) return DEFAULT_BASE_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65_533) {
    throw new Failure(
      `--base-port must be an integer from 1024 to 65533, got "${value}"`,
      'Pass --base-port 3300, or omit it',
    )
  }
  return port
}

/** @returns {Paths} */
export const paths = (basePort) => {
  const dataDir = join(tmpdir(), `oct-verify-${basePort}`)
  return {
    dataDir,
    stateFile: join(dataDir, 'state.json'),
    evidenceDir: join(tmpdir(), `oct-verify-${basePort}-evidence`),
  }
}

/** @returns {State} */
export const newState = ({ basePort, repo, seedUser, processes }) => {
  const { dataDir, evidenceDir } = paths(basePort)
  return {
    basePort,
    repo,
    dataDir,
    evidenceDir,
    webUrl: `http://localhost:${basePort}`,
    apiUrl: `http://localhost:${basePort + 1}`,
    cdpUrl: `http://127.0.0.1:${basePort + 2}`,
    seedUser,
    startedAt: new Date().toISOString(),
    processes,
  }
}

/** @returns {Promise<State | undefined>} */
export const readState = async (basePort) => {
  try {
    return JSON.parse(await readFile(paths(basePort).stateFile, 'utf8'))
  } catch {
    return undefined
  }
}

/** @param {State} state */
export const writeState = async (state) => {
  const { stateFile } = paths(state.basePort)
  await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${stateFile}.tmp`, stateFile)
}
