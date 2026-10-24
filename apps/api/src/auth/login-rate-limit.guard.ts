import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { AppConfig } from '../config.js'

const WINDOW_MS = 60 * 1000

type Window = { startedAt: number; requests: number }

// Fixed-window limit of login requests per client IP.
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>()

  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp()
    const ip = http.getRequest<Request>().ip ?? 'unknown'
    const now = Date.now()

    const current = this.windows.get(ip)
    const window =
      current === undefined || now - current.startedAt >= WINDOW_MS
        ? { startedAt: now, requests: 0 }
        : current
    window.requests++
    this.windows.set(ip, window)

    if (window.requests <= this.config.loginRateLimit) return true

    const retryAfterSeconds = Math.ceil((window.startedAt + WINDOW_MS - now) / 1000)
    http.getResponse<Response>().setHeader('Retry-After', String(retryAfterSeconds))
    throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS)
  }
}
