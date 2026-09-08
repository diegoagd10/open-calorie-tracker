import { workerData } from "node:worker_threads";

if ((workerData as { provider?: string }).provider === "open-food-facts") await import("./off-worker.ts");
else await import("./foundation-worker.ts");
