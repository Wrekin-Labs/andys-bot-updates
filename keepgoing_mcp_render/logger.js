// Minimal structured JSON logger. One line per event, secret-looking values
// redacted, long strings bounded. Never pass prompts, tokens or raw payloads.
import { looksSecret } from "./security_utils.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({
  sink = (line, level) => (level === "error" || level === "warn" ? console.error(line) : console.log(line)),
  minLevel = process.env.KEEPGOING_LOG_LEVEL || "info",
  base = {}
} = {}) {
  const threshold = LEVELS[minLevel] ?? LEVELS.info;

  function emit(level, event, fields = {}) {
    if ((LEVELS[level] ?? 0) < threshold) return;
    const record = { ts: new Date().toISOString(), level, event: String(event), ...base };
    for (const [key, value] of Object.entries(fields || {})) {
      record[key] = sanitise(key, value);
    }
    try {
      sink(JSON.stringify(record), level);
    } catch {
      // Logging must never throw into request or job paths.
    }
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (extra = {}) => createLogger({ sink, minLevel, base: { ...base, ...extra } })
  };
}

const SENSITIVE_KEYS = /^(authorization|token|access_token|refresh_token|secret|password|api_?key|cookie|prompt|input|goal|context|content|text|body)$/i;

function sanitise(key, value) {
  if (SENSITIVE_KEYS.test(key)) return "[redacted]";
  if (value == null) return value;
  if (value instanceof Error) {
    const message = String(value.message || "error");
    return { message: looksSecret(message) ? "redacted protected error" : message.slice(0, 300), code: value.code || null, status: value.status || null };
  }
  if (typeof value === "string") {
    return looksSecret(value) ? "[redacted]" : value.replace(/[\r\n]+/g, " ").slice(0, 300);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitise("", item));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) out[k] = sanitise(k, v);
    return out;
  }
  return String(value).slice(0, 100);
}

export const log = createLogger();
