# Coding standards

## Architecture

Keep feature behavior in its owning `app/` domain and keep React Router modules
at the HTTP/UI edge. Each module owns its behavior and its repository; other
modules use its service rather than its tables. Modules may import each other
directly, without circular dependencies.

`app/database/` owns the SQLite connection and the shared schema. Read
environment values through the nearest typed `runtime.server.ts` boundary.
Browser `*.client.ts` modules, such as the same-origin ceremony transport in
`app/auth/*.client.ts`, may use browser fetch and WebAuthn APIs; they never
import server code or access storage or process APIs. Keep process-level
Express concerns in `server/`.

## UI consistency

For every new or changed screen, compare its controls with equivalent controls
on the same page and in existing app screens. Reuse the established typography,
spacing, colors, borders, radii, sizes, and interaction states. Controls in one
form, including inputs, selects, and textareas, should share the same visual
language unless their different purpose calls for a visible distinction.

Open the affected screen in a browser at desktop and mobile widths, and in each
supported theme. Fix visible inconsistencies before completing the change; when
one control is inconsistent, check its peer controls on that screen too.

## Type safety and behavior

Preserve the strict TypeScript contract. Validate untrusted input at its edge
and pass domain code values that already satisfy its types and invariants.

Test observable behavior at the narrowest stable seam. Keep domain and service
tests deterministic; use Playwright for browser integration and the explicit
external suites only for behavior that requires their environment.

## Completion

**Verification:** Before handing off or reviewing a code change, read
`docs/verification.md` and complete the gate selected there. When an intentional
change affects inherited quality debt, follow that document's baseline review
workflow before completion.
