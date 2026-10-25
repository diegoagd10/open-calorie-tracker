// What became of a request to change the water log. "gone" means the entry no longer exists,
// e.g. it was deleted in another tab.
export type WaterOutcome = 'saved' | 'gone' | 'failed' | 'unauthorized'

const send = async (method: string, path: string, body?: unknown): Promise<WaterOutcome> => {
  try {
    const response = await fetch(`/api/water-entries${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (response.status === 401) {
      // The session expired: a full navigation lets the proxy clear it and show the login page.
      window.location.assign('/login')
      return 'unauthorized'
    }
    if (response.status === 404) return 'gone'
    return response.ok ? 'saved' : 'failed'
  } catch {
    return 'failed'
  }
}

export const addWater = (amount: number) => send('POST', '', { amount })

export const updateWater = (id: number, amount: number) => send('PATCH', `/${id}`, { amount })

export const deleteWater = (id: number) => send('DELETE', `/${id}`)
