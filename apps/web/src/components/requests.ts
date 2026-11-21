export const logInAgain = () => window.location.assign('/login')

export type Outcome = 'saved' | 'gone' | 'failed' | 'unauthorized'

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
      logInAgain()
      return { outcome: 'unauthorized' }
    }
    if (response.status === 404) return { outcome: 'gone' }
    return response.ok ? { outcome: 'saved', response } : { outcome: 'failed' }
  } catch {
    return { outcome: 'failed' }
  }
}
