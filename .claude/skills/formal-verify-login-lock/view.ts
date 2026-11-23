type Variables = {
  failures: number
  lock: 'none' | 'active' | 'past'
  wrong: number
  right: number
  guesses: number
  letInWhileLocked: boolean
}

const MAX_FAILED_ATTEMPTS = 5

export const title = 'Login lock: 5 password checks per IP and username'

export const state = ({ lock, wrong, right, guesses, letInWhileLocked }: Variables) => {
  if (letInWhileLocked) return 'Let in while locked'
  if (guesses > MAX_FAILED_ATTEMPTS) {
    return lock === 'active' ? 'Locked after more than 5 checks' : 'More than 5 checks started'
  }
  const running = wrong + right > 0
  if (lock === 'active') return running ? 'Locked, a check still runs' : 'Locked'
  if (lock === 'past') return running ? 'Lock over, a check still runs' : 'Lock over'
  return running ? 'Checking passwords' : 'Waiting for a login'
}

const LABELS: Record<string, string> = {
  ArriveWrong: 'a login starts a check',
  ArriveRight: 'a login starts a check',
  RefuseLocked: 'a login is refused',
  RefuseFull: 'a login is refused',
  WrongCounted: 'a check ends without a lock',
  RightConfirmed: 'the right password logs in',
  CheckThrows: 'a check ends without a lock',
  WrongLocks: 'a wrong password locks the account',
  LockRunsOut: '15 minutes pass',
}

export const step = (action: string) => LABELS[action] ?? null
