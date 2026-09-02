function sensitiveEnvironmentName(value) {
  return /(api.?key|authorization|contact.?email|cookie|credential|csrf|password|secret|session|token)/i.test(
    value,
  );
}

function configuredSensitiveValues() {
  return Object.entries(process.env)
    .filter(
      ([name, value]) =>
        sensitiveEnvironmentName(name) && value.length > 0,
    )
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
}

function redactText(value) {
  let redacted = value.replace(
    /((?:api.?key|authorization|cookie|credential|csrf|password|secret|session|token)=)[^&\s;]+/gi,
    "$1[REDACTED]",
  );
  for (const sensitiveValue of configuredSensitiveValues()) {
    redacted = redacted.replaceAll(sensitiveValue, "[REDACTED]");
  }
  return redacted;
}

function redact(value, key) {
  if (sensitiveEnvironmentName(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

export function operationalLog(level, event, details = {}) {
  const record = redact({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  });
  const serialized = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export function operationalError(error, includeMessage = true) {
  if (!(error instanceof Error)) {
    return includeMessage
      ? { name: "UnknownError", message: "Unknown operational failure" }
      : { name: "UnknownError" };
  }
  return includeMessage
    ? { name: error.name, message: redactText(error.message) }
    : { name: error.name };
}
