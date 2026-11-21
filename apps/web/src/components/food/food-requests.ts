import type {
  CreateFoodEntryInput,
  FoodEntryInput,
  ServingSize,
} from '@open-calorie-tracker/shared'
import { type Outcome, sendRequest } from '@/components/requests'

export const loadServingSizes = async (): Promise<ServingSize[]> => {
  try {
    const response = await fetch('/api/serving-sizes')
    return response.ok ? ((await response.json()) as ServingSize[]) : []
  } catch {
    return []
  }
}

export const saveServingSize = async (
  name: string,
): Promise<{ outcome: Outcome; servingSize?: ServingSize }> => {
  const { outcome, response } = await sendRequest('POST', '/api/serving-sizes', { name })
  if (response === undefined) return { outcome }
  try {
    return { outcome, servingSize: (await response.json()) as ServingSize }
  } catch {
    return { outcome: 'failed' }
  }
}

export const addFood = async (entry: CreateFoodEntryInput): Promise<Outcome> =>
  (await sendRequest('POST', '/api/food-entries', entry)).outcome

export const updateFood = async (id: number, entry: FoodEntryInput): Promise<Outcome> =>
  (await sendRequest('PATCH', `/api/food-entries/${id}`, entry)).outcome

export const deleteFood = async (id: number): Promise<Outcome> =>
  (await sendRequest('DELETE', `/api/food-entries/${id}`)).outcome
