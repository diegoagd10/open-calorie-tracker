import { argon2, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

function configuredInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }

  return value;
}

const parameters = {
  memory: configuredInteger(
    "AUTH_ARGON2_MEMORY_KIB",
    19_456,
    19_456,
    1_048_576,
  ),
  parallelism: 1,
  passes: configuredInteger("AUTH_ARGON2_PASSES", 2, 2, 10),
  tagLength: 32,
};
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
