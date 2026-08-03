import "dotenv/config";
import { createApplication } from "./app.js";
import { openDatabase } from "./db/client.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const connection = openDatabase(config.dataDir);
const application = createApplication({ config, connection, migrate: false });

const server = application.app.listen(config.port, () => {
  process.stdout.write(`Calories is running at http://localhost:${config.port}\n`);
});

function shutdown(): void {
  server.close(() => {
    application.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
