import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { applyMigrations } from "./db/migrations.js";
import { closeDatabase, openDatabase } from "./db/client.js";
import { Store, writeExport } from "./persistence/store.js";

const config = loadConfig();
const command = process.argv[2];

if (command === "migrate") {
  const connection = openDatabase(config.dataDir);
  applyMigrations(connection.sqlite);
  closeDatabase(connection);
  process.stdout.write(`Applied migrations in ${config.dataDir}\n`);
} else if (command === "backup") {
  const connection = openDatabase(config.dataDir);
  applyMigrations(connection.sqlite);
  const store = new Store(connection);
  store.ensureUser(config.timezone);
  const destination = await writeExport(config.dataDir, store);
  closeDatabase(connection);
  await fs.writeFile(path.join(destination, "BACKUP_NOTE.txt"), "This export is a logical backup. For SQLite consistency, stop the application before archiving the complete DATA_DIR.\n");
  process.stdout.write(`Backup written to ${destination}\n`);
} else {
  process.stderr.write("Usage: pnpm migrate | pnpm backup\n");
  process.exitCode = 1;
}
