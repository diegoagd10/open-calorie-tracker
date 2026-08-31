# Route testing strategy

React Router route modules already provide the testing seam. Their public
interface is the exported `loader`, `action`, and default component; production
and tests should cross that same interface.

## What each test level owns

Vitest route tests exercise server behavior with real Fetch `Request` objects,
React Router arguments, and temporary SQLite storage. A test calls loaders and
actions directly, then observes redirects, response data, or a later loader
call. Presentation is rendered with `createRoutesStub` and route data, so forms,
messages, and structural content are verified inside a real router context.

These tests do not mock application modules, export private helpers, or inspect
database tables as a shortcut. SQLite is a local-substitutable dependency, so
using the real database keeps the route interface as the test surface. Remote
catalog behavior may use the existing `FoodCatalogProvider` port and its test
adapter because that is a true external seam.

Playwright continues to own behavior that needs a browser: hydration, effects,
input interaction, focus, accessibility, navigation history, and the complete
HTTP/cookie stack. A passing Vitest route test does not replace the matching
browser scenario.

## Deep-module rule

A route is an adapter at the React Router seam. Domain decisions belong in the
existing deep modules behind it, such as setup validation and Goal Setup. Move
logic only when doing so hides meaningful behavior behind a smaller interface
that both the route and tests use. Do not extract JSX, pass-through functions,
or route-only factories merely to make mutation coverage easier.

The setup increment required no production extraction: its loader, action, and
component were directly testable through their existing interface with the real
local database. Adding a dependency port would have introduced a hypothetical
seam with no second production adapter.

## First measured increment

`tests/routes/setup-route.test.ts` follows a new account from its authenticated
setup loader through server-rendered presentation, rejected invalid input, a
successful action, and the post-completion redirect. Persistence is observed
through the loader rather than through database internals.

Measured against the baseline from issue #55:

| Measurement | Before | Setup increment |
| --- | ---: | ---: |
| Overall mutation score | 29.96% | 31.62% |
| `app/routes/setup.tsx` killed | 0 | 34 |
| `app/routes/setup.tsx` survived | 0 | 81 |
| `app/routes/setup.tsx` no coverage | 155 | 40 |

The 115 newly covered route mutants and 34 detected mutants are evidence, not a
target. The surviving mutants describe possible future assertions; they are not
grounds to weaken the result or invent an arbitrary percentage.

## Reviewable next increments

Keep each change centered on one user capability and update the measured
baseline only after its tests and surviving-mutant report are reviewed.

1. Authentication routes: register, login, logout, and password change through
   their route interfaces, preserving browser coverage for cookies and focus.
2. Goal Version settings: loader, validation failures, successful replacement,
   and server-rendered feedback for `settings.goals.tsx`.
3. Food Log reading: authentication/setup redirects, selected dates, calendar,
   entry/water editors, notices, and server-rendered daily presentation.
4. Food Log water actions: create, update, delete, stale-write feedback, and
   invalid/future-date responses through the home action.
5. Food Log food/catalog actions: search/detail failures plus log, update,
   delete, stale-write, and invalid-input responses through the home action.
6. Operational routes and process adapter: live/readiness responses, Express
   request handling, startup, and shutdown while retaining deployment tests.

No increment is accepted merely for reaching a score. Its tests must specify
documented behavior through the route interface; `pnpm mutation:test` then
reports the evidence and rejects regression below the latest reviewed baseline.
