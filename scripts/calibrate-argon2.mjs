import { argon2, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

import { getArgon2Profile } from "./argon2-profile.mjs";

const parameters = getArgon2Profile({ useTestProfile: false });
const durations = [];

for (let sample = 0; sample < 3; sample += 1) {
  const startedAt = performance.now();
  await new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        ...parameters,
        message: randomBytes(32),
        nonce: randomBytes(16),
      },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
  durations.push(performance.now() - startedAt);
}

const averageDurationMs =
  durations.reduce((total, duration) => total + duration, 0) /
  durations.length;

console.log(
  JSON.stringify({
    algorithm: "argon2id",
    averageDurationMs: Math.round(averageDurationMs),
    maximumDurationMs: Math.round(Math.max(...durations)),
    parameters,
    samples: durations.length,
  }),
);

if (Math.max(...durations) >= 1_000) {
  console.error("Argon2 calibration failed: a sample reached one second.");
  process.exitCode = 1;
}
