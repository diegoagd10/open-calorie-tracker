import assert from "node:assert/strict";
import test from "node:test";

import {
  compareWithBaseline,
  summarizeMutationReport,
} from "./mutation-report.mjs";

function mutant(status, mutatorName) {
  return { status, mutatorName };
}

test("summarizes mutation score and surviving mutants", () => {
  const report = {
    files: {
      "app/auth/token.server.ts": {
        mutants: [
          mutant("Killed", "StringLiteral"),
          mutant("Timeout", "EqualityOperator"),
          mutant("Survived", "StringLiteral"),
        ],
      },
      "app/root.tsx": {
        mutants: [
          mutant("NoCoverage", "ConditionalExpression"),
          mutant("Ignored", "StringLiteral"),
        ],
      },
    },
  };

  assert.deepEqual(summarizeMutationReport(report, 12.6), {
    schemaVersion: 1,
    durationMs: 13,
    mutationScore: 50,
    counts: {
      Pending: 0,
      Killed: 1,
      Timeout: 1,
      Survived: 1,
      NoCoverage: 1,
      RuntimeError: 0,
      CompileError: 0,
      Ignored: 1,
      detected: 2,
      undetected: 2,
      valid: 4,
      total: 5,
    },
    survivingMutants: {
      byModule: { "app/auth": 1 },
      byCategory: { StringLiteral: 1 },
    },
    undetectedMutants: {
      byModule: { app: 1, "app/auth": 1 },
      byCategory: { ConditionalExpression: 1, StringLiteral: 1 },
    },
  });
});

test("detects score regressions without rounding", () => {
  const baseline = {
    mutationScore: (2 / 3) * 100,
    counts: { detected: 2, valid: 3 },
  };

  assert.equal(
    compareWithBaseline(
      { mutationScore: (3 / 4) * 100, counts: { detected: 3, valid: 4 } },
      baseline,
    ).regressed,
    false,
  );
  assert.equal(
    compareWithBaseline(
      { mutationScore: (1 / 2) * 100, counts: { detected: 1, valid: 2 } },
      baseline,
    ).regressed,
    true,
  );
});
