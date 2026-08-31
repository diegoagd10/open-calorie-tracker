import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateCodeQlResults } from "./check-codeql-results.mjs";

test("accepts a successful CodeQL run with no findings", () => {
  const errors = evaluateCodeQlResults([
    {
      runs: [
        {
          invocations: [{ executionSuccessful: true }],
          results: [],
        },
      ],
    },
  ]);

  assert.deepEqual(errors, []);
});

test("rejects every CodeQL finding", () => {
  const errors = evaluateCodeQlResults([
    {
      runs: [
        {
          invocations: [{ executionSuccessful: true }],
          results: [
            {
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "app/example.ts" },
                    region: { startLine: 42 },
                  },
                },
              ],
              message: { text: "Unsafe behavior" },
              ruleId: "js/example-query",
            },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(errors, [
    "js/example-query at app/example.ts:42: Unsafe behavior",
  ]);
});

test("accepts only an exact reviewed CodeQL finding", () => {
  const document = {
    runs: [
      {
        invocations: [{ executionSuccessful: true }],
        results: [
          {
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "app/auth/token.server.ts" },
                  region: { startLine: 4 },
                },
              },
            ],
            message: { text: "Password is hashed insecurely." },
            partialFingerprints: {
              primaryLocationLineHash: "reviewed-line:1",
            },
            ruleId: "js/insufficient-password-hash",
          },
        ],
      },
    ],
  };
  const reviewedFinding = {
    path: "app/auth/token.server.ts",
    primaryLocationLineHash: "reviewed-line:1",
    rationale: "The value is an opaque token, not a password.",
    ruleId: "js/insufficient-password-hash",
  };

  assert.deepEqual(evaluateCodeQlResults([document], [reviewedFinding]), []);
  assert.deepEqual(
    evaluateCodeQlResults([document], [
      { ...reviewedFinding, primaryLocationLineHash: "different-line:1" },
    ]),
    [
      "js/insufficient-password-hash at app/auth/token.server.ts:4: Password is hashed insecurely.",
      "Reviewed CodeQL finding no longer matches: js/insufficient-password-hash at app/auth/token.server.ts (different-line:1).",
    ],
  );
});

test("allows reviewed base findings to be absent from differential SARIF", () => {
  const reviewedFinding = {
    path: "app/auth/token.server.ts",
    primaryLocationLineHash: "reviewed-line:1",
    rationale: "The value is an opaque token, not a password.",
    ruleId: "js/insufficient-password-hash",
  };
  const differentialDocument = {
    runs: [
      {
        invocations: [{ executionSuccessful: true }],
        results: [],
      },
    ],
  };

  assert.deepEqual(
    evaluateCodeQlResults([differentialDocument], [reviewedFinding], {
      requireReviewedMatches: false,
    }),
    [],
  );
});

test("still rejects unreviewed findings in differential SARIF", () => {
  const reviewedFinding = {
    path: "app/auth/token.server.ts",
    primaryLocationLineHash: "reviewed-line:1",
    rationale: "The value is an opaque token, not a password.",
    ruleId: "js/insufficient-password-hash",
  };
  const differentialDocument = {
    runs: [
      {
        invocations: [{ executionSuccessful: true }],
        results: [
          {
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "app/example.ts" },
                  region: { startLine: 42 },
                },
              },
            ],
            message: { text: "Unsafe behavior" },
            ruleId: "js/example-query",
          },
        ],
      },
    ],
  };

  assert.deepEqual(
    evaluateCodeQlResults([differentialDocument], [reviewedFinding], {
      requireReviewedMatches: false,
    }),
    ["js/example-query at app/example.ts:42: Unsafe behavior"],
  );
});

test("rejects missing results and unsuccessful invocations", () => {
  assert.deepEqual(evaluateCodeQlResults([]), [
    "CodeQL produced no SARIF documents.",
  ]);
  assert.deepEqual(
    evaluateCodeQlResults([
      {
        runs: [
          {
            invocations: [{ executionSuccessful: false }],
            results: [],
          },
        ],
      },
    ]),
    ["CodeQL reported an unsuccessful analysis invocation."],
  );
});
