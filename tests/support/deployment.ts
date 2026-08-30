import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ExtraMigration = {
  sql: string;
  tag: string;
};

type MigrationJournal = {
  entries: Array<{
    breakpoints: boolean;
    idx: number;
    tag: string;
    version: string;
    when: number;
  }>;
};

export async function createMigrationFolder(
  target: string,
  options: {
    extraMigration?: ExtraMigration;
    throughTag?: string;
  } = {},
) {
  await cp(path.resolve("drizzle"), target, { recursive: true });
  const journalPath = path.join(target, "meta", "_journal.json");
  const journal = JSON.parse(
    await readFile(journalPath, "utf8"),
  ) as MigrationJournal;

  if (options.throughTag) {
    const lastIndex = journal.entries.findIndex(
      (entry) => entry.tag === options.throughTag,
    );
    if (lastIndex < 0) {
      throw new Error(`migration ${options.throughTag} is not in the journal`);
    }
    journal.entries = journal.entries.slice(0, lastIndex + 1);
  }

  if (options.extraMigration) {
    const previous = journal.entries.at(-1);
    if (!previous) throw new Error("migration journal is empty");
    journal.entries.push({
      breakpoints: true,
      idx: previous.idx + 1,
      tag: options.extraMigration.tag,
      version: previous.version,
      when: previous.when + 1,
    });
    await writeFile(
      path.join(target, `${options.extraMigration.tag}.sql`),
      options.extraMigration.sql,
    );
  }

  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return target;
}

export async function waitForHttpResponse(
  url: string,
  options: {
    accepts?: (response: Response) => boolean;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const accepts = options.accepts ?? (() => true);
  const timeoutAt = Date.now() + (options.timeoutMs ?? 15_000);
  let lastError: unknown = new Error(`no accepted response from ${url}`);

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(url);
      if (accepts(response)) return response;
      lastError = new Error(`response returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, options.intervalMs ?? 50),
    );
  }
  throw lastError;
}
