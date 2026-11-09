import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../../src/shared/types';

const entry = (event: string, data: Record<string, unknown>): LogEntry => ({ ts: 1, level: 'info', scope: 'fill', event, data });

// A service worker restart resets module state, and a fresh import does the same here.
async function freshDb() {
  vi.resetModules();
  return import('../../src/shared/db');
}

describe('log store', () => {
  it('removes old suggestion logs and keeps everything else', async () => {
    const db = await freshDb();
    await db.appendLog(entry('combobox.options', { options: ['123 Maple St'] }));
    await db.appendLog(entry('combobox.noOption', { options: ['123 Maple St'] }));
    await db.appendLog(entry('combobox.typedTextCleared', { options: [] }));
    await db.appendLog(entry('field.result', { detail: 'typed search "Acme", option score 0.9' }));
    await db.appendLog(entry('combobox.options', { suggestions: { redacted: 'array', length: 1 } }));
    await db.appendLog(entry('field.result', { detail: 'set' }));
    await db.appendLog(entry('select.noOption', { options: ['Yes', 'No'] }));

    expect(await db.purgeSuggestionLogs()).toBe(4);
    const kept = (await db.readLogs()).map((log) => log.event);
    expect(kept.sort()).toEqual(['combobox.options', 'field.result', 'select.noOption']);
  });

  it('stays near the cap when the worker restarts before each prune is due', async () => {
    for (let life = 0; life < 201; life++) {
      const db = await freshDb();
      for (let write = 0; write < 100; write++) await db.appendLog(entry('tick', { life, write }));
    }
    const db = await freshDb();
    const stored = (await db.readLogs()).length;
    expect(stored).toBeGreaterThanOrEqual(20000);
    expect(stored).toBeLessThan(20200);
  }, 240000);
});
