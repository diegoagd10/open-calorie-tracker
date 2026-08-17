# Calorie Tracker Authentication Mock

This workspace contains the version-one authentication mock derived from `PRD.md` and `TDD.md`.

## Stack

- pnpm workspace
- Ionic React and TypeScript iOS-first PWA installed from Safari
- Node.js, Express 5, and TypeScript mock API
- Vitest and Supertest for API contract tests

The API stores data in memory and exposes a development-only mail-link helper. It is a review aid, not the approved production SQLite implementation.

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The Vite development server proxies `/v1` and `/_mock` requests to Express on port `3001`.

The production client build emits a standalone web app manifest, Apple touch icon, and service worker for iPhone Add to Home Screen installation.

Use `delivery-failure@example.com` to review the initial delivery-failure and immediate-resend flow. The check-email screen includes a clearly labeled prototype shortcut that opens the generated magic link without a real email provider.

The Express integration suite covers the complete request-to-session boundary, replay rejection, delivery failure recovery, session lookup, and current-phone sign-out.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```
