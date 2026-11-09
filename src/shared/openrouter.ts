// One-click sign-in for OpenRouter. The user approves Rote on openrouter.ai and
// OpenRouter hands back an API key tied to their account. Rote never sees their password.
// The flow is OAuth with PKCE, as described at https://openrouter.ai/docs/guides/overview/auth/oauth.

// OpenRouter sends the browser here with the one-time code. The code is useless
// without the verifier, which never leaves this extension.
export const CALLBACK_URL = 'https://rote.walker-computers.com/openrouter';
export const DEFAULT_MODEL = 'openrouter/auto';
const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const WAIT_MS = 10 * 60000;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function authUrl(challenge: string, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('callback_url', CALLBACK_URL);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('key_label', 'Rote');
  url.searchParams.set('state', state);
  return url.href;
}

// Reads the code out of the address OpenRouter sent the tab to. Returns nothing for any other address.
export function codeFrom(address: string, state: string): string | undefined {
  if (!address.startsWith(CALLBACK_URL)) return undefined;
  const params = new URL(address).searchParams;
  const code = params.get('code');
  if (!code) throw new Error('OpenRouter did not approve the sign-in.');
  if (params.get('state') !== state) throw new Error('The sign-in reply did not match this request. Try again.');
  return code;
}

export async function exchange(code: string, verifier: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
  } catch {
    throw new Error('Could not reach OpenRouter to finish the sign-in.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body?.key !== 'string') throw new Error(`OpenRouter refused the sign-in with error ${response.status}. Try again.`);
  return body.key;
}

// Opens the approval page in a tab, waits for OpenRouter to send it back, and returns the new key.
export async function signIn(): Promise<string> {
  const verifier = randomToken();
  const state = randomToken();
  const tab = await chrome.tabs.create({ url: authUrl(await challengeFor(verifier), state) });
  const code = await new Promise<string>((resolve, reject) => {
    const stop = () => {
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      clearTimeout(timer);
    };
    const updated = (tabId: number, change: { url?: string }) => {
      if (tabId !== tab.id || !change.url) return;
      try {
        const found = codeFrom(change.url, state);
        if (!found) return;
        stop();
        resolve(found);
      } catch (error) {
        stop();
        reject(error);
      }
      void chrome.tabs.remove(tabId).catch(() => undefined);
    };
    const removed = (tabId: number) => {
      if (tabId !== tab.id) return;
      stop();
      reject(new Error('The sign-in tab was closed before OpenRouter finished.'));
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error('The sign-in took longer than ten minutes. Try again.'));
    }, WAIT_MS);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
  });
  return exchange(code, verifier);
}
