import type { NextRequest } from 'next/server'
import { forwardToMcp } from '@/clients/mcp'

// The MCP server for AI assistants, reachable on the web app's hostname. Without sessions on the
// API there is nothing to open with GET or end with DELETE, so Next.js answers those with 405.
export function POST(request: NextRequest) {
  return forwardToMcp(request)
}
