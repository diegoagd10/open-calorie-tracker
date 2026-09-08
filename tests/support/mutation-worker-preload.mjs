import { getEnvironmentData, parentPort } from "node:worker_threads";

const context = getEnvironmentData("open-calorie:mutation-worker");
if (context) {
  // Stryker instruments worker code too, but its Vitest runner only collects the test thread.
  const state = globalThis.__stryker__ = { ...context };
  process.on("exit", () => {
    parentPort.postMessage({ mutationWorkerCoverage: { coverage: state.mutantCoverage, hitCount: state.hitCount } });
  });
}
