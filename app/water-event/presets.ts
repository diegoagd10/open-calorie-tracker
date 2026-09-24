export const WATER_PRESET_MICROLITERS = {
  "8": 236_588,
  "16": 473_176,
  "24": 709_765,
} as const;

export type WaterPreset = keyof typeof WATER_PRESET_MICROLITERS;
export type WaterPresetCounts = Record<WaterPreset, number>;

export function waterPresetTotalMicroliters(counts: WaterPresetCounts): number {
  return counts["8"] * WATER_PRESET_MICROLITERS["8"] +
    counts["16"] * WATER_PRESET_MICROLITERS["16"] +
    counts["24"] * WATER_PRESET_MICROLITERS["24"];
}

export function waterPresetTotalOunces(counts: WaterPresetCounts): number {
  return counts["8"] * 8 + counts["16"] * 16 + counts["24"] * 24;
}
