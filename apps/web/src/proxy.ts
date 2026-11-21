import { type NextRequest, NextResponse } from 'next/server'
import { fetchNeedsSetup } from '@/clients/users'
import { hasValidSession } from '@/lib/session'

const redirectTo = (path: string, request: NextRequest) =>
  NextResponse.redirect(new URL(path, request.url))

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const needsSetup = await fetchNeedsSetup()
  if (needsSetup === undefined) return NextResponse.next()

  if (needsSetup) {
    return pathname === '/register' ? NextResponse.next() : redirectTo('/register', request)
  }

  const loggedIn = await hasValidSession(request)
  if (pathname === '/login' || pathname === '/register') {
    if (loggedIn) return redirectTo('/', request)
    return pathname === '/login' ? NextResponse.next() : redirectTo('/login', request)
  }
  return loggedIn ? NextResponse.next() : redirectTo('/login', request)
}

export const config = {
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
}
