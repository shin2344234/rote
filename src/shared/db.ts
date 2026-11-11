// IndexedDB storage. Only extension pages and the service worker touch this.
// Content scripts never read the profile. They receive only the values being filled.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Application, BankAnswer, ClaudeSettings, LogEntry, Profile, ProfileInfo, StoredResume } from './types';

interface Schema extends DBSchema {
  kv: { key: string; value: unknown };
  resumes: { key: string; value: StoredResume };
  answers: { key: string; value: BankAnswer };
  logs: { key: number; value: LogEntry };
  applications: { key: string; value: Application };
}

const MAX_LOGS = 20000;
let handle: Promise<IDBPDatabase<Schema>> | undefined;

function db() {
  handle ??= openDB<Schema>('resume-autofill', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('kv');
        database.createObjectStore('resumes', { keyPath: 'id' });
        database.createObjectStore('answers', { keyPath: 'id' });
        database.createObjectStore('logs', { autoIncrement: true });
      }
      if (oldVersion < 2) database.createObjectStore('applications', { keyPath: 'id' });
    },
  });
  return handle;
}

export function emptyProfile(): Profile {
  return { fields: {}, work: [], education: [], skills: [], updatedAt: 0 };
}

export const MAIN_PROFILE = 'main';

// The first profile keeps the key it had before there were several, so an update finds it.
const profileKey = (id: string) => (id === MAIN_PROFILE ? 'profile' : `profile:${id}`);

export async function listProfiles(): Promise<ProfileInfo[]> {
  const saved = (await (await db()).get('kv', 'profiles')) as ProfileInfo[] | undefined;
  return saved?.length ? saved : [{ id: MAIN_PROFILE, name: 'Main profile' }];
}

async function saveProfileList(list: ProfileInfo[]): Promise<void> {
  await (await db()).put('kv', list, 'profiles');
}

export async function activeProfileId(): Promise<string> {
  const id = (await (await db()).get('kv', 'activeProfile')) as string | undefined;
  const list = await listProfiles();
  return list.some((info) => info.id === id) ? id! : list[0].id;
}

export async function activeProfileInfo(): Promise<ProfileInfo> {
  const id = await activeProfileId();
  return (await listProfiles()).find((info) => info.id === id)!;
}

export async function setActiveProfile(id: string): Promise<void> {
  await (await db()).put('kv', id, 'activeProfile');
}

// Starts from a copy of an existing profile, since most details stay the same across roles.
export async function createProfile(name: string, copy: Profile): Promise<string> {
  const id = crypto.randomUUID();
  const list = await listProfiles();
  await (await db()).put('kv', { ...structuredClone(copy), updatedAt: Date.now() }, profileKey(id));
  await saveProfileList([...list, { id, name }]);
  return id;
}

export async function updateProfileInfo(id: string, change: Partial<Omit<ProfileInfo, 'id'>>): Promise<void> {
  await saveProfileList((await listProfiles()).map((info) => (info.id === id ? { ...info, ...change } : info)));
}

export async function deleteProfile(id: string): Promise<void> {
  const list = await listProfiles();
  if (list.length < 2) throw new Error('The last profile cannot be deleted.');
  const rest = list.filter((info) => info.id !== id);
  await (await db()).delete('kv', profileKey(id));
  await saveProfileList(rest);
  if ((await (await db()).get('kv', 'activeProfile')) === id) await setActiveProfile(rest[0].id);
}

export async function getProfile(id?: string): Promise<Profile> {
  const key = profileKey(id ?? await activeProfileId());
  return ((await (await db()).get('kv', key)) as Profile | undefined) ?? emptyProfile();
}

export async function saveProfile(profile: Profile, id?: string): Promise<void> {
  await (await db()).put('kv', { ...profile, updatedAt: Date.now() }, profileKey(id ?? await activeProfileId()));
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
  const list = await listProfiles();
  if (list.some((info) => info.resumeId === id)) await saveProfileList(list.map((info) => (info.resumeId === id ? { ...info, resumeId: undefined } : info)));
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

// A multi-step form keeps its title as the steps change the address, so a fill with the
// same host and title soon after the last one is the same application.
const SAME_APPLICATION_MS = 6 * 3600000;

export async function recordApplication(seen: Pick<Application, 'url' | 'host' | 'title' | 'resume' | 'profile'>, now = Date.now()): Promise<Application> {
  const database = await db();
  const all = await database.getAll('applications');
  const match = all.find((app) => app.url === seen.url)
    ?? all.find((app) => app.host === seen.host && app.title === seen.title && now - app.lastFilled < SAME_APPLICATION_MS);
  const app: Application = match
    ? { ...match, lastFilled: now, fills: match.fills + 1, resume: seen.resume || match.resume }
    : { id: crypto.randomUUID(), ...seen, firstFilled: now, lastFilled: now, fills: 1, status: 'filled', note: '' };
  await database.put('applications', app);
  return app;
}

export async function listApplications(): Promise<Application[]> {
  return (await (await db()).getAll('applications')).sort((a, b) => b.lastFilled - a.lastFilled);
}

export async function updateApplication(id: string, change: Partial<Pick<Application, 'status' | 'note'>>): Promise<void> {
  const database = await db();
  const app = await database.get('applications', id);
  if (app) await database.put('applications', { ...app, ...change });
}

export async function deleteApplication(id: string): Promise<void> {
  await (await db()).delete('applications', id);
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
