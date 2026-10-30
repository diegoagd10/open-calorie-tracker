import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common'
import type { Request } from 'express'
import { AuthService } from './auth.service.js'

type AuthenticatedRequest = Request & { userId?: number }

// Lets a request through only with a valid "Authorization: Bearer <access token>" header.
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const [scheme, token] = request.headers.authorization?.split(' ') ?? []
    const userId =
      scheme === 'Bearer' && token ? await this.auth.verifyAccessToken(token) : undefined
    if (userId === undefined) throw new UnauthorizedException()

    request.userId = userId
    return true
  }
}

// The id of the user the AccessTokenGuard authenticated.
export const UserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().userId,
)
