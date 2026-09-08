import { inject, vi } from "vitest";

declare module "vitest" {
  interface ProvidedContext { activeMutant: string | undefined }
}

type Coverage = { static: Record<string, number>; perTest: Record<string, Record<string, number>> };
type MutationState = {
  activeMutant?: string;
  currentTestId?: string;
  hitCount?: number;
  hitLimit?: number;
  mutantCoverage?: Coverage;
};
function mutationState() {
  return (globalThis as typeof globalThis & { __stryker__?: MutationState }).__stryker__;
}
// A shared module can load before tests in this thread and during a test in a
// worker. Activate such hybrid mutations before either copy is initialized.
const state = mutationState();
if (state) state.activeMutant = inject("activeMutant");
function mergeCounts(target: Record<string, number>, incoming: Record<string, number>) {
  for (const [id, count] of Object.entries(incoming)) target[id] = (target[id] ?? 0) + count;
}
function receiveCoverage(message: { coverage?: Coverage; hitCount?: number }) {
  const state = mutationState();
  if (!state) return;
  if (message.coverage) {
    const coverage = state.mutantCoverage ??= { static: {}, perTest: {} };
    mergeCounts(coverage.static, message.coverage.static);
    for (const [testId, counts] of Object.entries(message.coverage.perTest)) {
      mergeCounts(coverage.perTest[testId] ??= {}, counts);
    }
  }
  if (state.hitCount !== undefined) state.hitCount += message.hitCount ?? 0;
}

// Keep real workers. Only the mutation runner's instrumentation crosses this boundary.
vi.mock("node:worker_threads", async importOriginal => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  class MeasuredWorker extends actual.Worker {
    constructor(filename: string | URL, options: import("node:worker_threads").WorkerOptions = {}) {
      const state = mutationState();
      if (!state) { super(filename, options); return; }
      const key = "open-calorie:mutation-worker";
      const previous = actual.getEnvironmentData(key);
      actual.setEnvironmentData(key, {
        activeMutant: state.activeMutant, currentTestId: state.currentTestId,
        hitCount: state.hitCount === undefined ? undefined : 0, hitLimit: state.hitLimit,
      });
      try {
        super(filename, {
          ...options,
          execArgv: [...(options.execArgv ?? []), "--import", new URL("./mutation-worker-preload.mjs", import.meta.url).href],
        });
      } finally { actual.setEnvironmentData(key, previous); }
    }
    override emit(event: string | symbol, ...args: unknown[]): boolean {
      if (event === "message" && typeof args[0] === "object" && args[0] !== null && "mutationWorkerCoverage" in args[0]) {
        receiveCoverage(args[0].mutationWorkerCoverage as { coverage?: Coverage; hitCount?: number });
        return true;
      }
      return super.emit(event, ...args);
    }
  }
  return { ...actual, Worker: MeasuredWorker };
});
