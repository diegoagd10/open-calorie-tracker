import { type Outcome, sendRequest } from '@/components/requests'

const send = async (method: string, path: string, body?: unknown): Promise<Outcome> =>
  (await sendRequest(method, `/api/water-entries${path}`, body)).outcome

export const addWater = (amount: number) => send('POST', '', { amount })

export const updateWater = (id: number, amount: number) => send('PATCH', `/${id}`, { amount })

export const deleteWater = (id: number) => send('DELETE', `/${id}`)
