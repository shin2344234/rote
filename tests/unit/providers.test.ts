import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeModel, askProvider, extractJson, providerName, testProvider } from '../../src/shared/providers';
import type { ClaudeSettings } from '../../src/shared/types';

const settings = (provider: string, config: Partial<{ apiKey: string; model: string; baseUrl: string }> = {}): ClaudeSettings => ({
  mode: 'openai', apiKey: '', model: 'claude-opus-5-5', provider,
  providers: { [provider]: { apiKey: '', model: '', baseUrl: '', ...config } },
});

const REQUEST = { system: 'Answer from the profile.', prompt: 'The questions.', schema: { type: 'object' } };
const reply = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop', ...extra }] }), { status: 200 });

interface Call { url: string; method: string; headers: Record<string, string>; body: any }

function stubFetch(...responses: (Response | Error)[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined });
    const next = responses.shift();
    if (!next) throw new Error('No response left for this call.');
    if (next instanceof Error) throw next;
    return next;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('extractJson', () => {
  it('reads plain JSON', () => {
    expect(extractJson('{"answers":[]}')).toEqual({ answers: [] });
  });

  it('reads JSON wrapped in reasoning tags, a code fence or a sentence', () => {
    expect(extractJson('<think>The user wants { braces }.</think>\n{"answers":[1]}')).toEqual({ answers: [1] });
    expect(extractJson('```json\n{"answers":[2]}\n```')).toEqual({ answers: [2] });
    expect(extractJson('Here is the reply. {"answers":[3]} Done.')).toEqual({ answers: [3] });
  });

  it('rejects a reply with no JSON in it', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow('something other than JSON');
  });
});

describe('provider names and models', () => {
  it('names Claude for the Anthropic connections and the preset otherwise', () => {
    expect(providerName({ mode: 'api', apiKey: '', model: 'claude-opus-5-5' })).toBe('Claude');
    expect(providerName({ mode: 'bridge', apiKey: '', model: 'claude-opus-5-5' })).toBe('Claude');
    expect(providerName(settings('lmstudio'))).toBe('LM Studio');
    expect(providerName(settings('custom', { baseUrl: 'http://box.lan:9000/v1' }))).toBe('box.lan:9000');
  });

  it('names OpenAI for its key connection and Codex for the local one', () => {
    expect(providerName({ ...settings('ollama'), mode: 'codex-api' })).toBe('OpenAI');
    expect(providerName({ ...settings('ollama'), mode: 'codex' })).toBe('Codex');
    expect(activeModel({ ...settings('codex', { model: 'some-model' }), mode: 'codex' })).toBe('some-model');
    expect(activeModel({ ...settings('ollama'), mode: 'codex' })).toBe('Codex default');
  });

  it('sends the OpenAI key connection to OpenAI whatever provider was picked before', async () => {
    const calls = stubFetch(reply('{"answers":[]}'));
    const saved: ClaudeSettings = {
      mode: 'codex-api', apiKey: '', model: 'claude-opus-5-5', provider: 'ollama',
      providers: { openai: { apiKey: 'fake-key', model: 'some-model', baseUrl: '' }, ollama: { apiKey: '', model: 'local-model', baseUrl: '' } },
    };
    await askProvider(saved, REQUEST);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer fake-key');
    expect(calls[0].body.model).toBe('some-model');
  });

  it('reports the model of whichever connection is selected', () => {
    expect(activeModel(settings('groq', { model: 'some-model' }))).toBe('some-model');
    expect(activeModel({ ...settings('groq', { model: 'some-model' }), mode: 'api' })).toBe('claude-opus-5-5');
  });
});

describe('askProvider', () => {
  it('posts the chat format with the key, the schema and the prompt', async () => {
    const calls = stubFetch(reply('{"answers":[]}'));
    expect(await askProvider(settings('openai', { apiKey: 'fake-key', model: 'some-model' }), REQUEST)).toEqual({ answers: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer fake-key');
    expect(calls[0].body.model).toBe('some-model');
    expect(calls[0].body.response_format.type).toBe('json_schema');
    expect(calls[0].body.messages[0].content).toContain('Answer from the profile.');
    expect(calls[0].body.messages[0].content).toContain('{"type":"object"}');
    expect(calls[0].body.messages[1]).toEqual({ role: 'user', content: 'The questions.' });
  });

  it('sends no key to a local server and trims a trailing slash from the base URL', async () => {
    const calls = stubFetch(reply('{"answers":[]}'));
    await askProvider(settings('ollama', { model: 'some-model', baseUrl: 'http://localhost:11434/v1/' }), REQUEST);
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('falls back to looser output formats when the server rejects one', async () => {
    const rejected = () => new Response('{"error":{"message":"unsupported response_format"}}', { status: 400 });
    const calls = stubFetch(rejected(), rejected(), reply('Sure. {"answers":[]}'));
    expect(await askProvider(settings('llamacpp', { model: 'some-model' }), REQUEST)).toEqual({ answers: [] });
    expect(calls.map((call) => call.body.response_format?.type)).toEqual(['json_schema', 'json_object', undefined]);
  });

  it('reads a reply that arrives as content parts', async () => {
    stubFetch(reply([{ type: 'text', text: '{"answers":' }, { type: 'text', text: '[]}' }]));
    expect(await askProvider(settings('ollama', { model: 'some-model' }), REQUEST)).toEqual({ answers: [] });
  });

  it('explains the common failures', async () => {
    const hosted = settings('openai', { apiKey: 'fake-key', model: 'some-model' });
    const local = settings('ollama', { model: 'some-model' });
    await expect(askProvider(settings('openai', { model: 'some-model' }), REQUEST)).rejects.toThrow('Add your OpenAI API key');
    await expect(askProvider(settings('ollama'), REQUEST)).rejects.toThrow('Pick a model for Ollama');
    await expect(askProvider(settings('custom', { model: 'some-model' }), REQUEST)).rejects.toThrow('Add a base URL');
    stubFetch(new Response('{}', { status: 401 }));
    await expect(askProvider(hosted, REQUEST)).rejects.toThrow('OpenAI rejected the API key');
    stubFetch(new Response('', { status: 403 }));
    await expect(askProvider(local, REQUEST)).rejects.toThrow('OLLAMA_ORIGINS');
    stubFetch(new TypeError('Failed to fetch'));
    await expect(askProvider(local, REQUEST)).rejects.toThrow('Could not reach Ollama at http://localhost:11434/v1');
    stubFetch(new Response('{"error":{"message":"overloaded"}}', { status: 503 }));
    await expect(askProvider(hosted, REQUEST)).rejects.toThrow('OpenAI returned error 503: overloaded');
    stubFetch(reply('{"answers":', { finish_reason: 'length' }));
    await expect(askProvider(hosted, REQUEST)).rejects.toThrow('ran out of room');
    stubFetch(reply(''));
    await expect(askProvider(hosted, REQUEST)).rejects.toThrow('empty reply');
  });
});

describe('testProvider', () => {
  it('lists models without generating any text', async () => {
    const calls = stubFetch(new Response(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }), { status: 200 }));
    const result = await testProvider(settings('ollama'));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('http://localhost:11434/v1/models');
    expect(result.models).toEqual(['a-model', 'b-model']);
    expect(result.message).toBe('Reached Ollama and found 2 model(s). Pick one in the Model box, then save.');
  });

  it('says whether the chosen model is on the list', async () => {
    const list = () => new Response(JSON.stringify({ data: [{ id: 'a-model' }] }), { status: 200 });
    stubFetch(list());
    expect((await testProvider(settings('ollama', { model: 'a-model' }))).message).toBe('Ollama is working and has a-model.');
    stubFetch(list());
    expect((await testProvider(settings('ollama', { model: 'other' }))).message).toContain('does not include other');
  });
});
