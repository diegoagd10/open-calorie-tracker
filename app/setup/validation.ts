/** The canonical IANA name of a time zone, or undefined when `value` is not one. */
export function canonicalTimeZone(value: string): string | undefined {
  const candidate = value.trim();
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate })
      .resolvedOptions()
      .timeZone;
  } catch {
    // Invalid IANA identifiers are represented by the undefined return below.
  }
  return undefined;
}
