function configuredInteger(
  environment,
  name,
  fallback,
  minimum,
  maximum,
) {
  const raw = environment[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }

  return value;
}

export function getArgon2Profile(options = {}) {
  const environment = options.environment ?? process.env;
  const useTestProfile =
    options.useTestProfile ?? environment.NODE_ENV === "test";

  if (useTestProfile) {
    return { memory: 64, parallelism: 1, passes: 1, tagLength: 32 };
  }

  return {
    memory: configuredInteger(
      environment,
      "AUTH_ARGON2_MEMORY_KIB",
      19_456,
      19_456,
      1_048_576,
    ),
    parallelism: 1,
    passes: configuredInteger(
      environment,
      "AUTH_ARGON2_PASSES",
      2,
      2,
      10,
    ),
    tagLength: 32,
  };
}
