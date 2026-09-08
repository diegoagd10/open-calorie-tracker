import { parentPort, workerData } from "node:worker_threads";
import type { ImportOptions } from "./import-contract.ts";

const options = workerData as ImportOptions & { provider?: string };
const publish = (message: unknown) => parentPort!.postMessage(message);
if (options.provider === "open-food-facts") await (await import("./off-import.server.ts")).importOff(options, publish);
else await (await import("./foundation-import.server.ts")).importFoundation(options, publish);
