const supportedCommercialBarcodeLengths = new Set([7, 8, 12, 13, 14]);

export function isSupportedCommercialBarcode(value: string): boolean {
  return !/\D/.test(value) && supportedCommercialBarcodeLengths.has(value.length);
}
