import { copyFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";

// Frozen generation written by ca9e19d, before aliases were indexed. Restore it
// through the worker boundary to exercise upgrades against the original format.
await copyFile(new URL("../fixtures/usda-foundation/name-only.sqlite", import.meta.url), path.join(workerData.directory, `${workerData.generation}.sqlite`));
parentPort.postMessage({ result: { foodCount: 19, publicationDateRange: { earliest: "2019-01-01", latest: "2026-01-01" } } });
