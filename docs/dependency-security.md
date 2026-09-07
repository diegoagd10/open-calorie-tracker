# Dependency security

The repository runs two dependency audits:

- `pnpm audit:prod` is the fast, exception-free check of the production graph.
  It fails when the registry reports any known production vulnerability.
- `pnpm audit:full` checks the complete graph. Its policy is stored in
  `.github/dependency-audit-allowlist.json`; every advisory, finding, version,
  dependency path, and development-only flag must match exactly. A new advisory
  or a changed finding fails the check.

## Temporary Drizzle Kit exception

The full audit currently permits only
[`GHSA-67mh-4wv8-2f99`](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
for `esbuild@0.18.20`, through this exact development dependency path:

```text
drizzle-kit
└── @esbuild-kit/esm-loader
    └── @esbuild-kit/core-utils
        └── esbuild@0.18.20
```

`drizzle-kit` is used for schema development and is not present in the
production dependency audit. The advisory concerns esbuild's development
server; the application does not use or expose that server. The exception is
therefore limited to this development-only transitive finding while Drizzle's
stable release still contains the old dependency. The upstream status is
tracked in [drizzle-team/drizzle-orm#4861](https://github.com/drizzle-team/drizzle-orm/issues/4861),
which is marked as fixed in beta.

Do not override esbuild to an incompatible version or adopt a prerelease of
Drizzle Kit merely to make the audit green.

## Removing the exception

When a stable Drizzle Kit release contains the upstream fix:

1. Upgrade `drizzle-kit` normally and regenerate `pnpm-lock.yaml`.
2. Run `pnpm audit:prod` and `pnpm audit:full`.
3. Delete the corresponding entry from
   `.github/dependency-audit-allowlist.json`.
4. Run `pnpm audit:policy` and both audits again.

The full audit intentionally fails if an allowlisted advisory disappears, so a
fixed dependency cannot leave a stale exception unnoticed.

## CodeQL results

The GitHub Actions CodeQL scan has been removed along with the other workflows.
`pnpm verify:deep` still runs `pnpm codeql:policy`, which tests the local SARIF
validator; these policy tests do not scan the application for vulnerabilities.

For a separately generated CodeQL SARIF report, run
`node scripts/check-codeql-results.mjs <sarif-directory>`. The validator
rejects missing reports, unsuccessful invocations, and findings outside the
versioned policy. There is no automatic scan, upload, or artifact retention.
