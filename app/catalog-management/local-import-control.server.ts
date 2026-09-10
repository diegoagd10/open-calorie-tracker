import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { catalogDirectory } from "./runtime.server";

const tokenPattern = /^[a-f0-9]{64}$/;

function localCatalogImportTokenPath(): string {
  return path.join(catalogDirectory(), ".local-import-token");
}

function validToken(value: string): string {
  const token = value.trim();
  if (!tokenPattern.test(token)) {
    throw new Error("Local catalog import control token is invalid.");
  }
  return token;
}

export async function ensureLocalCatalogImportToken(): Promise<string> {
  const tokenPath = localCatalogImportTokenPath();
  await mkdir(path.dirname(tokenPath), { mode: 0o700, recursive: true });
  try {
    await writeFile(tokenPath, `${randomBytes(32).toString("hex")}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await chmod(tokenPath, 0o600);
  return validToken(await readFile(tokenPath, "utf8"));
}

export async function readLocalCatalogImportToken(): Promise<string> {
  return validToken(await readFile(localCatalogImportTokenPath(), "utf8"));
}

export function localCatalogImportTokenMatches(
  expected: string,
  supplied: string | undefined,
): boolean {
  if (!supplied?.startsWith("Bearer ")) return false;
  const candidate = supplied.slice("Bearer ".length);
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
}
