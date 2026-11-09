// IndexedDB storage. Only extension pages and the service worker touch this.
// Content scripts never read the profile. They receive only the values being filled.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BankAnswer, ClaudeSettings, LogEntry, Profile, StoredResume } from './types';

interface Schema extends DBSchema {
  kv: { key: string; value: unknown };
  resumes: { key: string; value: StoredResume };
  answers: { key: string; value: BankAnswer };
  logs: { key: number; value: LogEntry };
}

const MAX_LOGS = 20000;
let handle: Promise<IDBPDatabase<Schema>> | undefined;

function db() {
  handle ??= openDB<Schema>('resume-autofill', 1, {
    upgrade(database) {
      database.createObjectStore('kv');
      database.createObjectStore('resumes', { keyPath: 'id' });
      database.createObjectStore('answers', { keyPath: 'id' });
      database.createObjectStore('logs', { autoIncrement: true });
    },
  });
  return handle;
}

export function emptyProfile(): Profile {
  return { fields: {}, work: [], education: [], skills: [], updatedAt: 0 };
}

export async function getProfile(): Promise<Profile> {
  return ((await (await db()).get('kv', 'profile')) as Profile | undefined) ?? emptyProfile();
}

export async function saveProfile(profile: Profile): Promise<void> {
  await (await db()).put('kv', { ...profile, updatedAt: Date.now() }, 'profile');
}

export async function getClaudeSettings(): Promise<ClaudeSettings> {
  const saved = (await (await db()).get('kv', 'claude')) as ClaudeSettings | undefined;
  return { mode: 'off', apiKey: '', model: 'claude-opus-5-5', provider: 'openai', providers: {}, ...saved };
}

export async function saveClaudeSettings(settings: ClaudeSettings): Promise<void> {
  await (await db()).put('kv', settings, 'claude');
}

export async function listResumes(): Promise<StoredResume[]> {
  return (await db()).getAll('resumes');
}

export async function addResume(resume: StoredResume): Promise<void> {
  const database = await db();
  const existing = await database.getAll('resumes');
  await database.put('resumes', { ...resume, isDefault: existing.length === 0 });
}

export async function setDefaultResume(id: string): Promise<void> {
  const database = await db();
  for (const resume of await database.getAll('resumes')) {
    await database.put('resumes', { ...resume, isDefault: resume.id === id });
  }
}

export async function deleteResume(id: string): Promise<void> {
  const database = await db();
  await database.delete('resumes', id);
  const rest = await database.getAll('resumes');
  if (rest.length && !rest.some((resume) => resume.isDefault)) await setDefaultResume(rest[0].id);
}

export async function listAnswers(): Promise<BankAnswer[]> {
  return (await db()).getAll('answers');
}

export async function putAnswer(answer: BankAnswer): Promise<void> {
  await (await db()).put('answers', answer);
}

export async function deleteAnswer(id: string): Promise<void> {
  await (await db()).delete('answers', id);
}

const PRUNE_EVERY = 500;
// Chrome stops the service worker often and this count resets with it, so each new worker prunes on its first write.
let writesSincePrune = PRUNE_EVERY - 1;

export async function appendLog(entry: LogEntry): Promise<void> {
  const database = await db();
  await database.add('logs', entry);
  if (++writesSincePrune < PRUNE_EVERY) return;
  writesSincePrune = 0;
  const excess = (await database.count('logs')) - MAX_LOGS;
  if (excess <= 0) return;
  const transaction = database.transaction('logs', 'readwrite');
  let cursor = await transaction.store.openCursor();
  for (let removed = 0; cursor && removed < excess; removed++) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await transaction.done;
}

export async function readLogs(): Promise<LogEntry[]> {
  return (await db()).getAll('logs');
}

const SUGGESTION_EVENTS = new Set(['combobox.options', 'combobox.typedTextCleared', 'combobox.noOption']);

// Older versions logged dropdown suggestions and typed searches in full, and those can hold an address or employer.
export async function purgeSuggestionLogs(): Promise<number> {
  const transaction = (await db()).transaction('logs', 'readwrite');
  let removed = 0;
  let cursor = await transaction.store.openCursor();
  while (cursor) {
    const { event, data } = cursor.value;
    if ((SUGGESTION_EVENTS.has(event) && data?.options) || (event === 'field.result' && String(data?.detail).includes('typed search "'))) {
      await cursor.delete();
      removed++;
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
  return removed;
}

export async function clearLogs(): Promise<void> {
  await (await db()).clear('logs');
}

const DEBUG_MINUTES = 30;

// Debug logging records personal values, so it switches itself off.
export async function setDebugLogging(on: boolean): Promise<void> {
  await chrome.storage.local.set({ debugUntil: on ? Date.now() + DEBUG_MINUTES * 60000 : 0 });
}

export async function debugUntil(): Promise<number> {
  const stored = await chrome.storage.local.get('debugUntil');
  return Number(stored.debugUntil ?? 0);
}
