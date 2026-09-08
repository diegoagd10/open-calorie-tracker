import { readFile } from "node:fs/promises";
import https from "node:https";

import {
  closeOnProcessSignals,
  createHttpApplication,
  mountOperationalErrorHandler,
  mountProductionApplication,
} from "./http-host.js";

const [keyPath, certificatePath, requestedPort = "4173"] = process.argv.slice(2);
if (!keyPath || !certificatePath) {
  throw new Error("TLS key and certificate paths are required.");
}
const port = Number.parseInt(requestedPort, 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("The browser test server port is invalid.");
}

const [key, cert] = await Promise.all([
  readFile(keyPath),
  readFile(certificatePath),
]);
const app = createHttpApplication();
const shutdown = await mountProductionApplication(app);
mountOperationalErrorHandler(app);

const server = https.createServer({ cert, key }, app);
server.requestTimeout = 2 * 60 * 60 * 1000;
server.listen(port, "0.0.0.0");
closeOnProcessSignals(server, shutdown);
