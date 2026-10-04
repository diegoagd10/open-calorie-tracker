import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql, type SQL } from "drizzle-orm";
import {
  getTableConfig,
  SQLiteSyncDialect,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";
import { expect, test } from "vitest";

import {
  openApplicationDatabase,
  type ApplicationDatabaseClient,
} from "../app/database/database.server";

type ColumnRow = {
  cid: number;
  dflt_value: string | null;
  name: string;
  notnull: 0 | 1;
  pk: number;
};

type ForeignKeyRow = {
  from: string;
  on_delete: string;
  table: string;
  to: string;
};

type IndexRow = {
  name: string;
  origin: string;
  unique: 0 | 1;
};

type IndexColumnRow = { name: string | null; seqno: number };
type SqlRow = { sql: string };

const dialect = new SQLiteSyncDialect();
type ConfiguredIndexColumn = ReturnType<
  typeof getTableConfig
>["indexes"][number]["config"]["columns"][number];

function rows<T>(client: ApplicationDatabaseClient, statement: string): T[] {
  return client.all(sql.raw(statement));
}

function canonicalSql(value: string): string {
  return value
    .replaceAll(/[`"]+/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function configuredIndexColumnName(
  column: ConfiguredIndexColumn,
): string | null {
  if ("name" in column) return column.name;
  const rendered = canonicalSql(dialect.sqlToQuery(column).sql);
  return /(?:^|\.)([a-z_]+)(?:\s+collate\s+[a-z_]+)?(?:\s+(?:asc|desc))?$/
    .exec(rendered)?.[1] ?? null;
}

function defaultValue(value: unknown): string | null {
  if (value === undefined) return null;
  return String(value);
}

test("Drizzle schema metadata matches the migrated SQLite contract", async () => {
  // This second module identity is deliberately loaded during the test so
  // @ts-expect-error Vite supports query-suffixed module identities.
  const schema = (await import("../app/database/schema.server?schema-contract")) as unknown as typeof import("../app/database/schema.server");
  const { waterEvents } = await import("../app/water-event/water-event.schema.server");
  const { dailyGoals } = await import("../app/daily-goal/daily-goal.schema.server");
  const tables: SQLiteTable[] = [
    schema.applicationMetadata,
    schema.users,
    schema.passwordCredentials,
    schema.sessions,
    schema.apiKeys,
    schema.preAuthenticationCsrfSessions,
    schema.rateLimitCounters,
    schema.userPreferences,
    dailyGoals,
    schema.foodEntries,
    waterEvents,
  ];
  const directory = await mkdtemp(path.join(tmpdir(), "calory-schema-contract-"));
  const database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const client = database.getClient();

  try {
    for (const table of tables) {
      const config = getTableConfig(table);
      const tableSql = client.get<SqlRow>(
        sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${config.name}`,
      );
      const columns = rows<ColumnRow>(
        client,
        `PRAGMA table_info("${config.name}")`,
      );

      expect(
        config.columns
          .map((column) => ({
            default: defaultValue(column.default),
            name: column.name,
            notNull: column.notNull,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ).toEqual(
        columns
          .map((column) => ({
            default:
              column.dflt_value === null
                ? null
                : column.dflt_value.replace(/^'(.*)'$/, "$1"),
            name: column.name,
            notNull: Boolean(column.notnull) || Boolean(column.pk),
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );

      const configuredPrimaryKey = [
        ...config.columns.filter((column) => column.primary).map(({ name }) => name),
        ...config.primaryKeys.flatMap((key) => key.columns.map(({ name }) => name)),
      ];
      expect(configuredPrimaryKey).toEqual(
        columns
          .filter(({ pk }) => pk > 0)
          .sort((left, right) => left.pk - right.pk)
          .map(({ name }) => name),
      );

      const actualAutoIncrementColumns = [
        ...tableSql.sql.matchAll(
          /[`"]?([^`"\s]+)[`"]?\s+integer\s+primary key\s+autoincrement/gi,
        ),
      ].map((match) => match[1]);
      expect(
        config.columns
          .filter(
            (column) =>
              "autoIncrement" in column && Boolean(column.autoIncrement),
          )
          .map(({ name }) => name),
      ).toEqual(actualAutoIncrementColumns);

      const foreignKeys = rows<ForeignKeyRow>(
        client,
        `PRAGMA foreign_key_list("${config.name}")`,
      );
      expect(
        config.foreignKeys.map((foreignKey) => {
          const reference = foreignKey.reference();
          return {
            from: reference.columns[0]?.name,
            onDelete: foreignKey.onDelete?.toUpperCase(),
            table: getTableConfig(reference.foreignTable).name,
            to: reference.foreignColumns[0]?.name,
          };
        }).sort((left, right) => left.from.localeCompare(right.from)),
      ).toEqual(
        foreignKeys.map((foreignKey) => ({
          from: foreignKey.from,
          onDelete: foreignKey.on_delete,
          table: foreignKey.table,
          to: foreignKey.to,
        })).sort((left, right) => left.from.localeCompare(right.from)),
      );

      const indexes = rows<IndexRow>(
        client,
        `PRAGMA index_list("${config.name}")`,
      ).filter(({ origin }) => origin === "c");
      expect(
        config.indexes
          .map((index) => ({
            name: index.config.name,
            unique: index.config.unique,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ).toEqual(
        indexes
          .map((index) => ({
            name: index.name,
            unique: Boolean(index.unique),
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );

      for (const index of config.indexes) {
        const actualColumns = rows<IndexColumnRow>(
          client,
          `PRAGMA index_info("${index.config.name}")`,
        )
          .sort((left, right) => left.seqno - right.seqno)
          .map(({ name }) => name);
        expect(index.config.columns).toHaveLength(actualColumns.length);
        expect(
          index.config.columns.map(configuredIndexColumnName),
        ).toEqual(actualColumns);

        for (const column of index.config.columns.filter(
          (candidate): candidate is SQL =>
            configuredIndexColumnName(candidate) === null,
        )) {
            const indexSql = client.get<SqlRow>(
              sql`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ${index.config.name}`,
            );
            const expression = dialect.sqlToQuery(column).sql;
            expect(canonicalSql(expression)).not.toBe("");
            expect(canonicalSql(indexSql.sql)).toContain(
              canonicalSql(expression).replace(`${config.name}.`, ""),
            );
        }

        const indexSql = canonicalSql(
          client.get<SqlRow>(
            sql`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ${index.config.name}`,
          ).sql,
        );
        const where = index.config.where
          ? canonicalSql(dialect.sqlToQuery(index.config.where).sql)
          : undefined;
        expect(
          indexSql.includes(" where ")
            ? indexSql.slice(indexSql.indexOf(" where ") + 7).replaceAll(`${config.name}.`, "")
            : undefined,
        ).toBe(where?.replaceAll(`${config.name}.`, ""));
      }

      const actualCheckNames = [
        ...tableSql.sql.matchAll(/CONSTRAINT\s+"?([^"\s]+)"?\s+CHECK/gi),
      ].map((match) => match[1]);
      expect(config.checks.map(({ name }) => name)).toEqual(actualCheckNames);
      for (const check of config.checks) {
        const expression = dialect.sqlToQuery(check.value).sql;
        expect(canonicalSql(expression)).not.toBe("");
        expect(canonicalSql(tableSql.sql)).toContain(canonicalSql(expression));
      }
    }
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("food snapshots accept coherent providers and reject mixed provider semantics", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-provider-schema-"));
  const database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  const client = database.getClient();

  const insert = (change: {
    authoritativeBaseUnit?: string;
    idempotencyKey: string;
    provider?: string;
    selectedMeasurementUnit?: string;
    sourceDataType?: string;
  }) =>
    client.run(sql.raw(`
      INSERT INTO food_entries (
        user_id, food_log_date, local_event_time, provider, provider_food_id,
        source_data_type, original_name, authoritative_base_unit,
        authoritative_base_quantity_microunits, selected_measurement_id,
        selected_measurement_label, selected_measurement_unit,
        selected_measurement_base_quantity_microunits, quantity_microunits,
        idempotency_key, created_at, updated_at
      ) VALUES (
        1, '2026-09-01', '12:00:00', '${change.provider ?? "open-food-facts"}',
        '0034000470693', '${change.sourceDataType ?? "Open Food Facts"}',
        'Example cereal', '${change.authoritativeBaseUnit ?? "serving"}',
        1000000, 'serving', '1 serving',
        '${change.selectedMeasurementUnit ?? "serving"}', 1000000, 1000000,
        '${change.idempotencyKey}', '2026-09-01T12:00:00.000Z',
        '2026-09-01T12:00:00.000Z'
      )
    `));

  try {
    client.run(sql.raw(
      "INSERT INTO users (id, username_normalized, created_at) VALUES (1, 'schema.owner', '2026-09-01T12:00:00.000Z')",
    ));
    expect(() => insert({ idempotencyKey: "valid-open-food-facts" }))
      .not.toThrow();
    expect(() =>
      insert({
        idempotencyKey: "valid-manual",
        provider: "manual",
        sourceDataType: "User entered",
      }),
    ).not.toThrow();
    expect(() =>
      insert({
        authoritativeBaseUnit: "g",
        idempotencyKey: "valid-open-food-facts-measured-serving",
        selectedMeasurementUnit: "g",
      }),
    ).not.toThrow();
    expect(() =>
      insert({
        authoritativeBaseUnit: "g",
        idempotencyKey: "mixed-open-food-facts-unit",
        selectedMeasurementUnit: "ml",
      }),
    ).toThrow();
    expect(() =>
      insert({
        idempotencyKey: "mixed-usda-source",
        provider: "usda-fdc",
      }),
    ).toThrow();
    expect(() =>
      insert({
        idempotencyKey: "unknown-provider",
        provider: "unknown",
      }),
    ).toThrow();
  } finally {
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
});
