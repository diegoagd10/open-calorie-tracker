import type { CreateWaterEntryInput } from '@open-calorie-tracker/shared'
import { type Outcome, sendRequest } from '@/components/requests'

const send = async (method: string, path: string, body?: unknown): Promise<Outcome> =>
  (await sendRequest(method, `/api/water-entries${path}`, body)).outcome

export const addWater = (entry: CreateWaterEntryInput) => send('POST', '', entry)

export const updateWater = (id: number, amount: number) => send('PATCH', `/${id}`, { amount })

export const deleteWater = (id: number) => send('DELETE', `/${id}`)
