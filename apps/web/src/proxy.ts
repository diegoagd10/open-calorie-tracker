import { type NextRequest, NextResponse } from 'next/server'
import { ACCESS_TOKEN_COOKIE, isValidAccessToken } from '@/lib/session'

const PUBLIC_PAGES = new Set(['/login'])

// Sends every page request without a valid session to the login page.
export async function proxy(request: NextRequest) {
  if (PUBLIC_PAGES.has(request.nextUrl.pathname)) return NextResponse.next()

  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  if (token !== undefined && (await isValidAccessToken(token))) return NextResponse.next()

  const response = NextResponse.redirect(new URL('/login', request.url))
  if (token !== undefined) response.cookies.delete(ACCESS_TOKEN_COOKIE)
  return response
}

export const config = {
  // Route handlers answer 401 themselves; Next.js internals and files with an extension
  // (favicon, public assets) need no session.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
}
