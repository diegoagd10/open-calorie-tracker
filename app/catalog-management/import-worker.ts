import { parentPort, workerData } from "node:worker_threads";
import type { ImportOptions } from "./import-contract.ts";
import { importFoundation } from "./foundation-import.server.ts";

await importFoundation(workerData as ImportOptions, (message: unknown) => parentPort!.postMessage(message));
