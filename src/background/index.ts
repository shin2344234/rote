// Service worker. Opens the side panel and owns the single log writer.
import { appendLog, debugUntil, purgeSuggestionLogs } from '../shared/db';
import { createLogger, errorData, redact, setLogSink } from '../shared/log';
import type { LogEntry } from '../shared/types';

let debugExpires = 0;
const debugReady = debugUntil().then((value) => (debugExpires = value));

chrome.storage.onChanged.addListener((changes) => {
  if (changes.debugUntil) debugExpires = Number(changes.debugUntil.newValue ?? 0);
});

let queue: Promise<unknown> = Promise.resolve();

function record(entry: LogEntry): void {
  queue = queue
    .then(() => debugReady)
    .then(() => {
      const safe = { ...entry, data: redact(entry.data, Date.now() < debugExpires) as LogEntry['data'] };
      console.debug(`[${safe.level}] ${safe.scope}.${safe.event}`, safe.data ?? '');
      return appendLog(safe);
    })
    .catch((error) => console.error('Log write failed', error));
}

setLogSink(record);
const log = createLogger('background');

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'log') return;
  record(message.entry as LogEntry);
});

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed', { reason: details.reason, version: chrome.runtime.getManifest().version });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void purgeSuggestionLogs()
    .then((removed) => log.info('logs.purged', { removed }))
    .catch((error) => log.error('logs.purgeFailed', errorData(error)));
});

self.addEventListener('unhandledrejection', (event) => log.error('unhandled', errorData(event.reason)));
self.addEventListener('error', (event) => log.error('uncaught', errorData(event.error ?? event.message)));
