import {
  argon2,
  randomBytes,
  timingSafeEqual,
  type Argon2Parameters,
} from "node:crypto";

const ALGORITHM = "argon2id";
const FORMAT_VERSION = 1;
const SALT_LENGTH = 16;

export type PasswordHashParameters = {
  memory: number;
  parallelism: number;
  passes: number;
  tagLength: number;
};

const productionParameters: PasswordHashParameters = {
  memory: 19_456,
  parallelism: 1,
  passes: 2,
  tagLength: 32,
};

const testParameters: PasswordHashParameters = {
  memory: 64,
  parallelism: 1,
  passes: 1,
  tagLength: 32,
};

function configuredInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
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

function currentParameters(): PasswordHashParameters {
  if (process.env.NODE_ENV === "test") {
    return testParameters;
  }

  return {
    memory: configuredInteger(
      "AUTH_ARGON2_MEMORY_KIB",
      productionParameters.memory,
      19_456,
      1_048_576,
    ),
    parallelism: productionParameters.parallelism,
    passes: configuredInteger(
      "AUTH_ARGON2_PASSES",
      productionParameters.passes,
      2,
      10,
    ),
    tagLength: productionParameters.tagLength,
  };
}

function derive(
  password: string,
  salt: Buffer,
  parameters: PasswordHashParameters,
): Promise<Buffer> {
  const options: Argon2Parameters = {
    message: Buffer.from(password, "utf8"),
    nonce: salt,
    ...parameters,
  };

  return new Promise((resolve, reject) => {
    argon2(ALGORITHM, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

function encode(
  salt: Buffer,
  hash: Buffer,
  parameters: PasswordHashParameters,
): string {
  return [
    ALGORITHM,
    `v=${FORMAT_VERSION}`,
    `m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism},l=${parameters.tagLength}`,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

type ParsedPasswordHash = {
  hash: Buffer;
  parameters: PasswordHashParameters;
  salt: Buffer;
  version: number;
};

function parse(encoded: string): ParsedPasswordHash | undefined {
  const [algorithm, versionPart, parametersPart, saltPart, hashPart, extra] =
    encoded.split("$");

  if (
    algorithm !== ALGORITHM ||
    extra !== undefined ||
    !versionPart?.startsWith("v=") ||
    !parametersPart ||
    !saltPart ||
    !hashPart
  ) {
    return undefined;
  }

  const entries = Object.fromEntries(
    parametersPart.split(",").map((entry) => entry.split("=", 2)),
  );
  const parameters = {
    memory: Number(entries.m),
    passes: Number(entries.t),
    parallelism: Number(entries.p),
    tagLength: Number(entries.l),
  };
  const version = Number(versionPart.slice(2));
  const salt = Buffer.from(saltPart, "base64url");
  const hash = Buffer.from(hashPart, "base64url");

  if (
    !Number.isInteger(version) ||
    !Object.values(parameters).every(
      (parameter) => Number.isInteger(parameter) && parameter > 0,
    ) ||
    salt.length < 8 ||
    hash.length !== parameters.tagLength
  ) {
    return undefined;
  }

  return { hash, parameters, salt, version };
}

export async function hashPassword(password: string): Promise<string> {
  const parameters = currentParameters();
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, parameters);

  return encode(salt, hash, parameters);
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<{ matches: boolean; needsRehash: boolean }> {
  const parsed = parse(encoded);

  if (!parsed) {
    return { matches: false, needsRehash: false };
  }

  const candidate = await derive(password, parsed.salt, parsed.parameters);
  const matches = timingSafeEqual(candidate, parsed.hash);
  const expected = currentParameters();
  const needsRehash =
    matches &&
    (parsed.version !== FORMAT_VERSION ||
      Object.entries(expected).some(
        ([key, value]) =>
          parsed.parameters[key as keyof PasswordHashParameters] !== value,
      ));

  return { matches, needsRehash };
}

export function createDummyPasswordHash(): string {
  const parameters = currentParameters();
  return encode(
    Buffer.alloc(SALT_LENGTH, 0xa5),
    Buffer.alloc(parameters.tagLength),
    parameters,
  );
}
