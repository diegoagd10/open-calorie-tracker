import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../src/db/database.js'
import { type TestApp, createTestApp } from './app.js'

describe('health (e2e)', () => {
  let app: TestApp

  beforeEach(async () => {
    app = await createTestApp()
  })

  afterEach(async () => {
    await app.close()
  })

  const health = () => request(app.getHttpServer()).get('/v1/health')

  it('answers 200 without a token while the database responds', async () => {
    const response = await health()

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })

  it('answers 503 when the database does not respond', async () => {
    app.get(Database).close()

    const response = await health()

    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'unavailable' })
  })
})
