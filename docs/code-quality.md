# Code quality gates

The fast local correction checks are:

```sh
pnpm typecheck
pnpm lint
```

`typecheck` generates React Router types and runs the TypeScript project with
the repository's strict compiler contract. `lint` analyzes application and
server production code, unit and browser tests, TypeScript configuration, and
JavaScript support scripts. Warnings and errors both produce a non-zero exit
code. For machine-readable output, `pnpm lint:ci` emits ESLint JSON to stdout.

`pnpm lint:policy` is a small executable contract for the environment-variable
boundary. It proves an access outside a runtime boundary fails and the same
access inside a runtime boundary succeeds.

## Type-aware linter selection

Oxlint type-aware is not compatible with the repository's supported TypeScript
line. Its current implementation is powered by typescript-go and requires
TypeScript 7.0 or newer, while this project fixes TypeScript 6.0.3 because the
stable Drizzle declarations do not compile on TypeScript 7. The compatibility
requirement is documented by
[Oxlint](https://oxc.rs/docs/guide/usage/linter/type-aware.html#typescript-compatibility),
and the TypeScript choice is recorded in the README.

The issue's single permitted fallback is therefore the only configured linter:
ESLint with `typescript-eslint` project service. Do not add a parallel,
syntax-only Oxlint gate; two authorities would produce different local and CI
contracts. Re-evaluate Oxlint type-aware when the project can move to
TypeScript 7.

The configuration enables ESLint recommended rules, the recommended
type-checked TypeScript rules, React Hooks rules, and Vitest rules. Three
type-checked rules are adjusted for established framework contracts:

- Form values are normalized to strings before Zod validates their domain
  shape, so `no-base-to-string` would report every `FormDataEntryValue` boundary.
- React Router intentionally throws `Response` objects for HTTP control flow,
  so `only-throw-error` cannot represent valid route behavior.
- Async service interfaces have synchronous test and in-memory
  implementations, so `require-await` would penalize interface consistency.

All other enabled findings are blocking. The USDA live audit alone disables
Vitest's conditional-expect rule because it conditionally validates optional
provider data; the deterministic test suites retain that rule.

## Environment-variable boundary

Application modules may not read `process.env` directly. Environment access is
limited to these audited boundaries in `eslint.config.js`:

- `app/runtime.server.ts` and context-specific `runtime.server.ts` modules;
- the server entry points and operational-log sanitizer;
- explicit scripts and tests, which configure or isolate child processes.

Code outside those boundaries receives a blocking `no-restricted-properties`
finding. Add a typed runtime accessor instead of widening the allowlist for a
consumer.

## TypeScript contract and deferred flags

The compiler enables `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noUnusedParameters`, and `noUnusedLocals` in
addition to `strict`. The initial two unused-local findings were corrected
without broad suppressions.

The following flags remain deferred based on a clean baseline run made while
introducing this contract:

- `noUncheckedIndexedAccess`: 20 existing errors across parsing, fixed-point
  conversion, and test helpers. Enabling it safely requires explicit runtime
  bounds and parsing decisions rather than assertions added only for the type
  checker.
- `exactOptionalPropertyTypes`: 7 existing errors at authentication, route
  response, catalog option, and test-fixture boundaries. The code first needs a
  consistent absent-versus-explicit-`undefined` contract.
- `noPropertyAccessFromIndexSignature`: 310 existing errors, overwhelmingly
  generated CSS-module index signatures. Enable it only after CSS modules have
  declarations with named exports; rewriting every access to bracket notation
  would obscure the UI code without improving safety.

`skipLibCheck` remains enabled solely for dependency declarations and is
documented separately in the README. Application, server, test, and
configuration sources remain in the TypeScript project.
