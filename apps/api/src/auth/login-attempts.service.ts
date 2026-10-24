import { Injectable } from '@nestjs/common'

export const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000

type Attempts = { failures: number; lockedUntil: number | undefined }

// Tracks failed logins per (IP, username), so an attacker can only lock an account for their own IP.
@Injectable()
export class LoginAttemptsService {
  private readonly attempts = new Map<string, Attempts>()

  isLocked(ip: string, username: string): boolean {
    const key = this.key(ip, username)
    const lockedUntil = this.attempts.get(key)?.lockedUntil
    if (lockedUntil === undefined) return false
    if (lockedUntil > Date.now()) return true

    this.attempts.delete(key)
    return false
  }

  // Returns true when this failure locks the account.
  recordFailure(ip: string, username: string): boolean {
    const key = this.key(ip, username)
    const failures = (this.attempts.get(key)?.failures ?? 0) + 1
    const locked = failures >= MAX_FAILED_ATTEMPTS
    this.attempts.set(key, {
      failures,
      lockedUntil: locked ? Date.now() + LOCK_DURATION_MS : undefined,
    })
    return locked
  }

  reset(ip: string, username: string) {
    this.attempts.delete(this.key(ip, username))
  }

  private key(ip: string, username: string) {
    return JSON.stringify([ip, username])
  }
}
