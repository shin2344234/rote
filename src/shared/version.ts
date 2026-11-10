// The panel compares its own version with the newest GitHub release. The answer is kept
// for a few hours so opening the panel many times sends one request, and any failure
// leaves the panel showing just its version.
export const LATEST_URL = 'https://api.github.com/repos/shin2344234/rote/releases/latest';
export const UPDATE_PAGE = 'https://rote.walker-computers.com/#update';
const CHECK_EVERY = 6 * 60 * 60 * 1000;
const CACHE_KEY = 'latestRelease';

function parts(version: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

interface Cached { version: string; checkedAt: number }

export async function latestVersion(now = Date.now()): Promise<string | undefined> {
  const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] as Cached | undefined;
  if (stored && now - stored.checkedAt < CHECK_EVERY && now >= stored.checkedAt) return stored.version;
  try {
    const response = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!response.ok) return stored?.version;
    const tag = (await response.json() as { tag_name?: unknown }).tag_name;
    if (typeof tag !== 'string' || !parts(tag)) return stored?.version;
    const version = tag.replace(/^v/, '');
    await chrome.storage.local.set({ [CACHE_KEY]: { version, checkedAt: now } satisfies Cached });
    return version;
  } catch {
    return stored?.version;
  }
}
