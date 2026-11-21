import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Database } from '../db/database.js'

@Controller('v1/health')
export class HealthController {
  constructor(private readonly database: Database) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.database.db.run(sql`SELECT 1`)
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' })
    }
    return { status: 'ok' }
  }
}
