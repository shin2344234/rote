import { afterEach, describe, expect, it, vi } from 'vitest';
import { authUrl, CALLBACK_URL, challengeFor, codeFrom, exchange, randomToken } from '../../src/shared/openrouter';
import { chatModels } from '../../src/shared/providers';

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouter sign-in', () => {
  it('derives the challenge from the verifier as RFC 7636 specifies', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes a fresh URL-safe token each time', () => {
    const first = randomToken();
    expect(first).toMatch(/^[\w-]{43}$/);
    expect(randomToken()).not.toBe(first);
  });

  it('sends the user to OpenRouter with the challenge and never the verifier', () => {
    const url = new URL(authUrl('the-challenge', 'the-state'));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callback_url: CALLBACK_URL, code_challenge: 'the-challenge', code_challenge_method: 'S256', key_label: 'Rote', state: 'the-state',
    });
  });

  it('takes the code only from the callback address and only with the right state', () => {
    expect(codeFrom('https://openrouter.ai/auth?callback_url=x', 's')).toBeUndefined();
    expect(codeFrom(`${CALLBACK_URL}?code=abc&state=s`, 's')).toBe('abc');
    expect(() => codeFrom(`${CALLBACK_URL}?code=abc&state=other`, 's')).toThrow('did not match');
    expect(() => codeFrom(`${CALLBACK_URL}?error=denied`, 's')).toThrow('did not approve');
  });

  it('trades the code and verifier for a key', async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ key: 'fake-openrouter-key' }), { status: 200 });
    });
    expect(await exchange('abc', 'the-verifier')).toBe('fake-openrouter-key');
    expect(calls[0]).toEqual({ url: 'https://openrouter.ai/api/v1/auth/keys', body: { code: 'abc', code_verifier: 'the-verifier', code_challenge_method: 'S256' } });
    vi.stubGlobal('fetch', async () => new Response('{"error":"Invalid code"}', { status: 403 }));
    await expect(exchange('abc', 'the-verifier')).rejects.toThrow('error 403');
  });
});

describe('signIn', () => {
  // Stands in for chrome.tabs. `go` plays the part of the tab moving to a new address.
  function fakeTabs() {
    const updated = new Set<(tabId: number, change: { url?: string }) => void>();
    const removed = new Set<(tabId: number) => void>();
    const state = { opened: '', closed: [] as number[], listeners: () => updated.size + removed.size };
    vi.stubGlobal('chrome', { tabs: {
      create: async ({ url }: { url: string }) => { state.opened = url; return { id: 7 }; },
      remove: async (tabId: number) => { state.closed.push(tabId); },
      onUpdated: { addListener: (fn: any) => updated.add(fn), removeListener: (fn: any) => updated.delete(fn) },
      onRemoved: { addListener: (fn: any) => removed.add(fn), removeListener: (fn: any) => removed.delete(fn) },
    } });
    return { state, go: (tabId: number, url: string) => updated.forEach((fn) => fn(tabId, { url })), close: (tabId: number) => removed.forEach((fn) => fn(tabId)) };
  }
  const opened = async (state: { opened: string }) => {
    await vi.waitFor(() => expect(state.opened).not.toBe(''));
    return new URL(state.opened).searchParams;
  };

  it('opens the approval tab, reads the code when the tab comes back, and returns the key', async () => {
    const tabs = fakeTabs();
    const bodies: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ key: 'fake-openrouter-key' }), { status: 200 });
    });
    const { signIn } = await import('../../src/shared/openrouter');
    const pending = signIn();
    const params = await opened(tabs.state);
    await vi.waitFor(() => expect(tabs.state.listeners()).toBe(2));

    tabs.go(8, `${CALLBACK_URL}?code=other-tab&state=${params.get('state')}`);
    tabs.go(7, 'https://openrouter.ai/sign-in');
    expect(bodies).toHaveLength(0);
    tabs.go(7, `${CALLBACK_URL}?code=the-code&state=${params.get('state')}`);

    expect(await pending).toBe('fake-openrouter-key');
    expect(bodies[0].code).toBe('the-code');
    expect(await challengeFor(bodies[0].code_verifier)).toBe(params.get('code_challenge'));
    expect(tabs.state.closed).toEqual([7]);
    expect(tabs.state.listeners()).toBe(0);
  });

  it('gives up when the tab is closed or the reply carries the wrong state', async () => {
    const { signIn } = await import('../../src/shared/openrouter');
    let tabs = fakeTabs();
    let pending = signIn();
    await opened(tabs.state);
    await vi.waitFor(() => expect(tabs.state.listeners()).toBe(2));
    tabs.close(7);
    await expect(pending).rejects.toThrow('closed before OpenRouter finished');

    tabs = fakeTabs();
    pending = signIn();
    await opened(tabs.state);
    await vi.waitFor(() => expect(tabs.state.listeners()).toBe(2));
    tabs.go(7, `${CALLBACK_URL}?code=the-code&state=forged`);
    await expect(pending).rejects.toThrow('did not match');
    expect(tabs.state.listeners()).toBe(0);
  });
});

describe('chatModels', () => {
  it('drops models that cannot answer a chat request', () => {
    expect(chatModels(['gpt-x', 'text-embedding-3', 'whisper-1', 'tts-1', 'gpt-image-1', 'omni-moderation'])).toEqual(['gpt-x']);
  });

  it('keeps the whole list when the filter would empty it', () => {
    expect(chatModels(['nomic-embed-text'])).toEqual(['nomic-embed-text']);
  });
});
