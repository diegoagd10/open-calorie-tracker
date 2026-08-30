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
