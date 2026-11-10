import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNewer, latestVersion, LATEST_URL } from '../../src/shared/version';

describe('isNewer', () => {
  it.each([
    ['0.1.9', '0.1.8', true],
    ['v0.2.0', '0.1.12', true],
    ['0.1.10', '0.1.9', true],
    ['1.0.0', '0.9.9', true],
    ['0.1.8', '0.1.8', false],
    ['v0.1.8', '0.1.8', false],
    ['0.1.7', '0.1.8', false],
    ['nightly', '0.1.8', false],
    ['', '0.1.8', false],
  ])('%s against %s is %s', (latest, current, expected) => {
    expect(isNewer(latest, current)).toBe(expected);
  });
});

describe('latestVersion', () => {
  let store: Record<string, unknown>;
  let calls: string[];

  beforeEach(() => {
    store = {};
    calls = [];
    vi.stubGlobal('chrome', { storage: { local: {
      get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
      set: async (values: Record<string, unknown>) => { Object.assign(store, values); },
    } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  function serve(body: unknown, status = 200) {
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(body), { status });
    });
  }

  it('reads the release tag and asks again only after six hours', async () => {
    serve({ tag_name: 'v0.1.9' });
    expect(await latestVersion(1000)).toBe('0.1.9');
    expect(await latestVersion(1000 + 5 * 3600000)).toBe('0.1.9');
    expect(calls).toEqual([LATEST_URL]);
    serve({ tag_name: 'v0.2.0' });
    expect(await latestVersion(1000 + 7 * 3600000)).toBe('0.2.0');
  });

  it('keeps the last known version when GitHub fails or sends junk', async () => {
    serve({ message: 'rate limited' }, 403);
    expect(await latestVersion(1000)).toBeUndefined();
    store.latestRelease = { version: '0.1.9', checkedAt: 0 };
    expect(await latestVersion(7 * 3600000)).toBe('0.1.9');
    serve({ tag_name: 'not-a-version' });
    expect(await latestVersion(7 * 3600000)).toBe('0.1.9');
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    expect(await latestVersion(7 * 3600000)).toBe('0.1.9');
  });
});
