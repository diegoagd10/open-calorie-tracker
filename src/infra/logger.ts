const SECRET_KEYS = /api.?key|authorization|token|secret|password|env|prompt|response|image|nutrition|nutrient/i;

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.test(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      safe[key] = sanitizeLogFields(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      safe[key] = `[${value.length} items]`;
    } else if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      safe[key] = value;
    }
  }
  return safe;
}

export interface TechnicalLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function write(level: string, event: string, fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ level, event, ...sanitizeLogFields(fields), at: new Date().toISOString() })}\n`);
}

export const logger: TechnicalLogger = {
  info: (event, fields = {}) => write("info", event, fields),
  warn: (event, fields = {}) => write("warn", event, fields),
  error: (event, fields = {}) => write("error", event, fields),
};
