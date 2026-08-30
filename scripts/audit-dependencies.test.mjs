import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateAudit } from "./audit-dependencies.mjs";

const allowedFinding = {
  bundled: false,
  dev: true,
  optional: false,
  path: ".>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild",
  version: "0.18.20",
};

const allowlist = {
  advisories: [
    {
      findings: [allowedFinding],
      githubAdvisoryId: "GHSA-67mh-4wv8-2f99",
      moduleName: "esbuild",
      pnpmAdvisoryId: 1102341,
      reason: "Development-only transitive dependency.",
      removeWhen: "A stable upstream fix is released.",
      upstream: "https://github.com/drizzle-team/drizzle-orm/issues/4861",
    },
  ],
};

const allowedAdvisory = {
  findings: [
    {
      bundled: allowedFinding.bundled,
      dev: allowedFinding.dev,
      optional: allowedFinding.optional,
      paths: [allowedFinding.path],
      version: allowedFinding.version,
    },
  ],
  github_advisory_id: "GHSA-67mh-4wv8-2f99",
  id: 1102341,
  module_name: "esbuild",
};

test("accepts only the documented advisory and exact dependency path", () => {
  assert.deepEqual(
    evaluateAudit({ advisories: { 1102341: allowedAdvisory } }, allowlist),
    [],
  );
});

test("rejects every additional advisory", () => {
  const errors = evaluateAudit(
    {
      advisories: {
        1102341: allowedAdvisory,
        1234567: {
          findings: [],
          github_advisory_id: "GHSA-new-advisory",
          id: 1234567,
          module_name: "another-package",
        },
      },
    },
    allowlist,
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0], /Unexpected advisory GHSA-new-advisory/);
});

test("rejects changes to the allowed dependency path", () => {
  const changedAdvisory = structuredClone(allowedAdvisory);
  changedAdvisory.findings[0].paths = [".>another-package>esbuild"];

  const errors = evaluateAudit(
    { advisories: { 1102341: changedAdvisory } },
    allowlist,
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0], /exact allowlisted version and dependency path/);
});

test("rejects a stale exception after the advisory is fixed", () => {
  const errors = evaluateAudit({ advisories: {} }, allowlist);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /remove its stale exception/);
});
