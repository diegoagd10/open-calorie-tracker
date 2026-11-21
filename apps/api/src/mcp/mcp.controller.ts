import {
  All,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { API_SCOPES } from '@open-calorie-tracker/shared'
import type { Request, Response } from 'express'
import { AuthService, type TokenSubject } from '../auth/auth.service.js'
import { API_KEY_PREFIX, ApiKeysService } from '../settings/api-keys/api-keys.service.js'
import { McpService } from './mcp.service.js'

@Controller('v1/mcp')
export class McpController {
  constructor(
    private readonly auth: AuthService,
    private readonly apiKeys: ApiKeysService,
    private readonly mcp: McpService,
  ) {}

  @Post()
  async handle(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const server = this.mcp.serverFor(await this.subjectOf(authorization))
    // oxlint-disable-next-line local/no-comments
    // Without a sessionIdGenerator, the transport is stateless.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request, response, request.body)
  }

  // oxlint-disable-next-line local/no-comments
  // Without sessions there is no stream to open with GET, nor a session to end with DELETE.
  @All()
  methodNotAllowed(): never {
    throw new HttpException('Method Not Allowed', HttpStatus.METHOD_NOT_ALLOWED)
  }

  private async subjectOf(authorization: string | undefined): Promise<TokenSubject> {
    const [scheme, credential] = authorization?.split(' ') ?? []
    if (scheme !== 'Bearer' || !credential) throw new UnauthorizedException()

    if (credential.startsWith(API_KEY_PREFIX)) {
      return { userId: await this.apiKeys.registerUse(credential), scopes: [...API_SCOPES] }
    }

    const subject = await this.auth.verifyAccessToken(credential)
    if (subject?.scopes === undefined) throw new UnauthorizedException()
    return subject
  }
}
