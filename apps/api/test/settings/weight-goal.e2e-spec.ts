import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Database } from '../../src/db/database.js'
import { seedUser } from '../../src/db/seed.js'
import { type TestApp, accessTokenFor, createTestApp, withBearer } from '../app.js'

const USERNAME = 'diego'
const OTHER_USERNAME = 'ana'
const PASSWORD = 'correct-horse-battery-staple'

const TEN_DAYS_AGO = '2026-10-16'
const TODAY = '2026-10-26'

const GOAL = { startWeight: 180, goalWeight: 150, date: TODAY }

describe('settings: weight goal (e2e)', () => {
  let app: TestApp
  let token: string

  beforeEach(async () => {
    app = await createTestApp()
    const database = app.get(Database)
    await seedUser(database, { username: USERNAME, password: PASSWORD })
    await seedUser(database, { username: OTHER_USERNAME, password: PASSWORD })
    token = await accessTokenFor(app, USERNAME, PASSWORD)
  })

  afterEach(async () => {
    await app.close()
  })

  const read = (bearer = token) =>
    withBearer(request(app.getHttpServer()).get('/v1/settings/weight-goal'), bearer)

  const save = (body: object, bearer = token) =>
    withBearer(request(app.getHttpServer()).put('/v1/settings/weight-goal').send(body), bearer)

  const goal = async (bearer = token) => {
    const response = await read(bearer)
    expect(response.status).toBe(200)
    expect(response.type).toBe('application/json')
    return JSON.parse(response.text) as unknown
  }

  it('A20 — a user who never set a goal has none', async () => {
    expect(await goal()).toBeNull()
  })

  it('A21 — saves the goal, starting on the date the browser sent', async () => {
    const response = await save(GOAL)

    const saved = { startWeight: 180, goalWeight: 150, startDate: TODAY }
    expect(response.status).toBe(200)
    expect(response.body).toEqual(saved)
    expect(await goal()).toEqual(saved)
  })

  it.each([
    ['a goal equal to the starting weight', { ...GOAL, goalWeight: 180 }],
    ['a goal over the starting weight', { ...GOAL, goalWeight: 185 }],
  ])('A22 — rejects %s with 400 and stores nothing', async (_case, body) => {
    expect((await save(body)).status).toBe(400)
    expect(await goal()).toBeNull()
  })

  it.each([
    ['no starting weight', { goalWeight: 150, date: TODAY }],
    ['no goal weight', { startWeight: 180, date: TODAY }],
    ['a starting weight over 999', { ...GOAL, startWeight: 1000 }],
    ['a goal weight under 50', { ...GOAL, goalWeight: 49.9 }],
    ['an unknown field', { ...GOAL, deadline: '2027-01-01' }],
  ])('A23 — rejects %s with 400 and stores nothing', async (_case, body) => {
    expect((await save(body)).status).toBe(400)
    expect(await goal()).toBeNull()
  })

  it('A24 — changing only the goal weight keeps the start date', async () => {
    await save({ ...GOAL, date: TEN_DAYS_AGO })

    const response = await save({ startWeight: 180, goalWeight: 155, date: TODAY })

    expect(response.status).toBe(200)
    expect(await goal()).toEqual({ startWeight: 180, goalWeight: 155, startDate: TEN_DAYS_AGO })
  })

  it('A25 — changing the starting weight starts the goal on the new date', async () => {
    await save({ ...GOAL, date: TEN_DAYS_AGO })

    await save({ startWeight: 178, goalWeight: 150, date: TODAY })

    expect(await goal()).toEqual({ startWeight: 178, goalWeight: 150, startDate: TODAY })
  })

  it("A26 — another user's goal is never answered", async () => {
    await save(GOAL)
    const otherToken = await accessTokenFor(app, OTHER_USERNAME, PASSWORD)

    expect(await goal(otherToken)).toBeNull()
  })
})
