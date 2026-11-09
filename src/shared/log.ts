// Logger used by every part of the extension. Entries reach one writer in the
// service worker, and redaction happens there so no caller can forget it.
import type { LogEntry, LogLevel } from './types';

type Sink = (entry: LogEntry) => void;

let sink: Sink = (entry) => {
  try {
    void chrome.runtime.sendMessage({ type: 'log', entry }).catch(() => undefined);
  } catch {
    // The extension was reloaded while this page stayed open. Logging must never break a fill.
  }
};

export function setLogSink(next: Sink): void {
  sink = next;
}

export function createLogger(scope: string, getRunId: () => string | undefined = () => undefined) {
  const write = (level: LogLevel, event: string, data?: Record<string, unknown>) =>
    sink({ ts: Date.now(), level, scope, event, runId: getRunId(), data });
  return {
    debug: (event: string, data?: Record<string, unknown>) => write('debug', event, data),
    info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
    warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
    error: (event: string, data?: Record<string, unknown>) => write('error', event, data),
  };
}

// Any property with one of these names holds personal data.
const PERSONAL_KEYS = new Set([
  'value', 'values', 'answer', 'chosen', 'text', 'rawtext', 'bytes', 'base64', 'email', 'phone', 'typed', 'suggestions',
]);

function describe(value: unknown): unknown {
  if (typeof value === 'string') return { redacted: 'string', length: value.length };
  if (Array.isArray(value)) return { redacted: 'array', length: value.length };
  if (value === null || value === undefined) return value;
  return { redacted: typeof value };
}

export function stripUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return value;
  }
}

// Removes personal values unless debug logging is on. URLs always lose their
// query strings because application links often carry tokens.
export function redact(input: unknown, debug: boolean, keyName = ''): unknown {
  const key = keyName.toLowerCase();
  if (!debug && PERSONAL_KEYS.has(key)) return describe(input);
  if (typeof input === 'string') {
    if ((key.endsWith('url') || key === 'href') && !debug) return stripUrl(input);
    return input.length > 2000 ? `${input.slice(0, 2000)}...[${input.length} chars]` : input;
  }
  if (Array.isArray(input)) return input.map((item) => redact(item, debug, keyName));
  if (input instanceof Error) return { name: input.name, message: input.message, stack: input.stack };
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, redact(v, debug, k)]));
  }
  return input;
}

export function errorData(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

export function newRunId(): string {
  return `${new Date().toISOString().slice(11, 19).replaceAll(':', '')}-${Math.random().toString(36).slice(2, 7)}`;
}
