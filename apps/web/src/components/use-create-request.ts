import type { CreateRequest } from '@open-calorie-tracker/shared'
import { useRef, useState } from 'react'

export const useCreateRequest = () => {
  const [requestId] = useState(() => crypto.randomUUID())
  const attempts = useRef(0)

  return (): CreateRequest => ({ requestId, attempt: ++attempts.current })
}
