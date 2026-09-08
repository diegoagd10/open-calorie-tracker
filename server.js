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
  const { port } = validateServerConfiguration(process.env);

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
        return await source.app(request, response, next);
      } catch (error) {
        if (error instanceof Error) {
          viteDevelopmentServer.ssrFixStacktrace(error);
        }
        next(error);
      }
    });
  } else {
    shutdownApplication = await mountProductionApplication(app);
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
  closeOnProcessSignals(server, shutdownApplication);
}

startServer().catch((error) => {
  operationalLog("error", "startup_failed", {
    error: operationalError(error),
  });
  process.exitCode = 1;
});
