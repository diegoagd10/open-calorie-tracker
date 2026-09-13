import {
  closeOnProcessSignals,
  createHttpApplication,
  mountOperationalErrorHandler,
  mountProductionApplication,
} from "./server/http-host.js";
import {
  operationalError,
  operationalLog,
} from "./server/operational-logging.js";
import { validateServerConfiguration } from "./server/startup-configuration.js";

const DEVELOPMENT = process.env.NODE_ENV === "development";

async function startServer() {
  const { port, lanPort, lanHost } = validateServerConfiguration(process.env);
  if (process.env.TRUST_PROXY !== undefined) {
    operationalLog("warn", "configuration_deprecated", { variable: "TRUST_PROXY", message: "TRUST_PROXY is obsolete and ignored" });
  }

  const app = createHttpApplication();
  let shutdownApplication;

  if (DEVELOPMENT) {
    const viteDevelopmentServer = await import("vite").then((vite) =>
      vite.createServer({ server: { middlewareMode: true } }),
    );
    const databaseRuntime = await viteDevelopmentServer.ssrLoadModule(
      "./app/database/runtime.server.ts",
    );

    databaseRuntime.initializeApplicationDatabase();
    shutdownApplication = async () => {
      const source = await viteDevelopmentServer.ssrLoadModule("./server/app.ts");
      await source.shutdown();
      await viteDevelopmentServer.close();
    };
    app.use(viteDevelopmentServer.middlewares);
    app.use(async (request, response, next) => {
      try {
        const source = await viteDevelopmentServer.ssrLoadModule("./server/app.ts");
        return await source.applicationForEntry("development")(request, response, next);
      } catch (error) {
        if (error instanceof Error) {
          viteDevelopmentServer.ssrFixStacktrace(error);
        }
        next(error);
      }
    });
  } else {
    shutdownApplication = await mountProductionApplication(app, "tunnel");
  }

  mountOperationalErrorHandler(app);

  const server = app.listen(port, "0.0.0.0", () => {
    operationalLog("info", "server_started", {
      port,
      environment: DEVELOPMENT ? "development" : process.env.NODE_ENV,
    });
  });

  // Allow administrator uploads of multi-gigabyte catalog archives.
  server.requestTimeout = 2 * 60 * 60 * 1000;
  const servers = [server];
  if (lanPort) {
    const lanApp = createHttpApplication();
    await mountProductionApplication(lanApp, "lan");
    mountOperationalErrorHandler(lanApp);
    const lanServer = lanApp.listen(lanPort, lanHost, () => {
      operationalLog("info", "server_started", { port: lanPort, entry: "lan", environment: process.env.NODE_ENV });
    });
    lanServer.requestTimeout = server.requestTimeout;
    servers.push(lanServer);
  }
  closeOnProcessSignals(servers, shutdownApplication);
}

startServer().catch((error) => {
  operationalLog("error", "startup_failed", {
    error: operationalError(error),
  });
  process.exitCode = 1;
});
