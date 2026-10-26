// What became of a request that changes the log. "gone" means the record no longer exists, e.g.
// it was deleted in another tab.
export type Outcome = 'saved' | 'gone' | 'failed' | 'unauthorized'

// Sends a request to one of the app's routes. A successful answer comes with its response.
export const sendRequest = async (
  method: string,
  url: string,
  body?: unknown,
): Promise<{ outcome: Outcome; response?: Response }> => {
  try {
    const response = await fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (response.status === 401) {
      // The session expired: a full navigation lets the proxy clear it and show the login page.
      window.location.assign('/login')
      return { outcome: 'unauthorized' }
    }
    if (response.status === 404) return { outcome: 'gone' }
    return response.ok ? { outcome: 'saved', response } : { outcome: 'failed' }
  } catch {
    return { outcome: 'failed' }
  }
}
