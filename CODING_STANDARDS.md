# Coding standards

## Architecture

Keep feature behavior in its owning `app/` domain and keep React Router modules
at the HTTP/UI edge. Follow the zones, dependency directions, and side-effect
owners declared in `.fallowrc.json`; change that contract only when the design
itself changes.

Read environment values through the nearest typed `runtime.server.ts` boundary.
Keep SQLite and Drizzle access in `app/database/`, and process-level Express
concerns in `server/`.

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
