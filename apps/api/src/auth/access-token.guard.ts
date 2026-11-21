import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type ApiScope, INSUFFICIENT_SCOPE_MESSAGE } from '@open-calorie-tracker/shared'
import type { Request } from 'express'
import { AuthService } from './auth.service.js'

type AuthenticatedRequest = Request & { userId?: number }

export const RequiresScope = Reflector.createDecorator<ApiScope>()

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const [scheme, token] = request.headers.authorization?.split(' ') ?? []
    const subject =
      scheme === 'Bearer' && token ? await this.auth.verifyAccessToken(token) : undefined
    if (subject === undefined) throw new UnauthorizedException()

    if (subject.scopes !== undefined) {
      const required = this.reflector.getAllAndOverride(RequiresScope, [
        context.getHandler(),
        context.getClass(),
      ])
      if (required === undefined || !subject.scopes.includes(required)) {
        throw new ForbiddenException(INSUFFICIENT_SCOPE_MESSAGE)
      }
    }

    request.userId = subject.userId
    return true
  }
}

export const UserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().userId,
)
