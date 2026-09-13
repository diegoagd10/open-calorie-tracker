import { readFile } from "node:fs/promises";
import https from "node:https";

import {
  closeOnProcessSignals,
  createHttpApplication,
  mountOperationalErrorHandler,
  mountProductionApplication,
} from "./http-host.js";

const [keyPath, certificatePath, requestedPort = "4173", lanPort] = process.argv.slice(2);
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
// Emulate the trusted connector for the public browser journeys. Production
// never synthesizes a visitor IP; production-process tests cover failures.
app.use((request, _response, next) => {
  request.headers["cf-connecting-ip"] = request.get("x-test-client-ip") ?? "203.0.113.10";
  request.rawHeaders.push("CF-Connecting-IP", request.headers["cf-connecting-ip"]);
  next();
});
const shutdown = await mountProductionApplication(app, "tunnel");
mountOperationalErrorHandler(app);

const server = https.createServer({ cert, key }, app);
server.requestTimeout = 2 * 60 * 60 * 1000;
server.listen(port, "0.0.0.0");
const servers = [server];
if (lanPort) {
  const lan = createHttpApplication();
  await mountProductionApplication(lan, "lan");
  mountOperationalErrorHandler(lan);
  const lanServer = lan.listen(Number(lanPort), "127.0.0.1");
  lanServer.requestTimeout = server.requestTimeout;
  servers.push(lanServer);
}
closeOnProcessSignals(servers, shutdown);
