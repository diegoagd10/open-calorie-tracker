import { type NextRequest, NextResponse } from 'next/server'
import { fetchNeedsSetup } from '@/clients/users'
import { hasValidSession } from '@/lib/session'

const redirectTo = (path: string, request: NextRequest) =>
  NextResponse.redirect(new URL(path, request.url))

// Until the account exists every page leads to /register. Afterwards /register is closed, and
// every page but /login needs a valid session.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const needsSetup = await fetchNeedsSetup()
  // The API is unreachable: let the page load, and its form report the failure.
  if (needsSetup === undefined) return NextResponse.next()

  if (needsSetup) {
    return pathname === '/register' ? NextResponse.next() : redirectTo('/register', request)
  }
  if (pathname === '/register') return redirectTo('/login', request)
  if (pathname === '/login') return NextResponse.next()

  return (await hasValidSession(request)) ? NextResponse.next() : redirectTo('/login', request)
}

export const config = {
  // Pages only: API routes, Next.js assets and files with an extension pass straight through.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
}
