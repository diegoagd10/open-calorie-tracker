import {
  argon2,
  randomBytes,
  timingSafeEqual,
  type Argon2Parameters,
} from "node:crypto";
import { promisify } from "node:util";

import {
  getArgon2Profile,
  type Argon2Profile,
} from "../../scripts/argon2-profile.mjs";

const ALGORITHM = "argon2id";
const FORMAT_VERSION = 1;
const SALT_LENGTH = 16;

type PasswordHashParameters = Argon2Profile;
const deriveArgon2 = promisify(argon2);

function currentParameters(): PasswordHashParameters {
  return getArgon2Profile();
}

function derive(
  password: string,
  salt: Buffer,
  parameters: PasswordHashParameters,
): Promise<Buffer> {
  const options: Argon2Parameters = {
    message: Buffer.from(password),
    nonce: salt,
    ...parameters,
  };

  return deriveArgon2(ALGORITHM, options);
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

  const entries = new URLSearchParams(parametersPart.replaceAll(",", "&"));
  const parameters = {
    memory: Number(entries.get("m")),
    passes: Number(entries.get("t")),
    parallelism: Number(entries.get("p")),
    tagLength: Number(entries.get("l")),
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
