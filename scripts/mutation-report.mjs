const MUTANT_STATUSES = [
  "Pending",
  "Killed",
  "Timeout",
  "Survived",
  "NoCoverage",
  "RuntimeError",
  "CompileError",
  "Ignored",
];

function emptyCounts() {
  return Object.fromEntries(MUTANT_STATUSES.map((status) => [status, 0]));
}

function moduleFor(fileName) {
  const segments = fileName.split("/");
  if (segments[0] === "app" && segments.length > 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0].replace(/\.[^.]+$/, "");
}

function sortedRecord(entries) {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

export function summarizeMutationReport(report, durationMs) {
  const counts = emptyCounts();
  const survivedByModule = {};
  const survivedByCategory = {};
  const undetectedByModule = {};
  const undetectedByCategory = {};

  for (const [fileName, file] of Object.entries(report.files)) {
    for (const mutant of file.mutants) {
      if (!(mutant.status in counts)) {
        throw new Error(`Unknown mutant status: ${mutant.status}`);
      }
      counts[mutant.status] += 1;

      if (mutant.status === "Survived") {
        increment(survivedByModule, moduleFor(fileName));
        increment(survivedByCategory, mutant.mutatorName);
      }
      if (mutant.status === "Survived" || mutant.status === "NoCoverage") {
        increment(undetectedByModule, moduleFor(fileName));
        increment(undetectedByCategory, mutant.mutatorName);
      }
    }
  }

  const detected = counts.Killed + counts.Timeout;
  const undetected = counts.Survived + counts.NoCoverage;
  const valid = detected + undetected;

  return {
    schemaVersion: 1,
    durationMs: Math.round(durationMs),
    mutationScore: valid === 0 ? 100 : (detected / valid) * 100,
    counts: {
      ...counts,
      detected,
      undetected,
      valid,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    },
    survivingMutants: {
      byModule: sortedRecord(Object.entries(survivedByModule)),
      byCategory: sortedRecord(Object.entries(survivedByCategory)),
    },
    undetectedMutants: {
      byModule: sortedRecord(Object.entries(undetectedByModule)),
      byCategory: sortedRecord(Object.entries(undetectedByCategory)),
    },
  };
}

export function compareWithBaseline(current, baseline) {
  const currentDetected = current.counts.detected;
  const currentValid = current.counts.valid;
  const baselineDetected = baseline.counts.detected;
  const baselineValid = baseline.counts.valid;
  const regressed =
    currentValid > 0 &&
    baselineValid > 0 &&
    currentDetected * baselineValid < baselineDetected * currentValid;

  return {
    regressed,
    difference: current.mutationScore - baseline.mutationScore,
  };
}
