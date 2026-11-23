import { z } from 'zod'

export const createRequestSchema = z.object({
  requestId: z.uuid().optional(),
  attempt: z.number().int().positive().optional(),
})

export type CreateRequest = z.infer<typeof createRequestSchema>
