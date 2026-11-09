// Sends a request to any hosted provider or local server that accepts the OpenAI chat completions format.
import type { ClaudeRequest } from './claude';
import type { ClaudeSettings } from './types';

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  needsKey: boolean;
  local: boolean;
  // Where the user creates an API key for this provider.
  keyUrl?: string;
}

export const PRESETS: Preset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, local: false, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, local: false, keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, local: false, keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, local: false, keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, local: false, keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', needsKey: true, local: false, keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', needsKey: true, local: false, keyUrl: 'https://console.x.ai' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', needsKey: true, local: false, keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false, local: true },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', needsKey: false, local: true },
  { id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1', needsKey: false, local: true },
  { id: 'custom', name: 'Custom server', baseUrl: '', needsKey: false, local: false },
];

interface Target {
  preset: Preset;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  local: boolean;
}

export function presetFor(id: string | undefined): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
}

function isLocal(baseUrl: string): boolean {
  try {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

// The Codex CLI keeps its optional model under this key in the saved providers.
export const CODEX_LOCAL = 'codex';

// True for the connections this file serves over HTTP.
export function usesProvider(settings: ClaudeSettings): boolean {
  return settings.mode === 'openai' || settings.mode === 'codex-api';
}

function target(settings: ClaudeSettings): Target {
  const preset = presetFor(settings.mode === 'codex-api' ? 'openai' : settings.provider);
  const saved = settings.providers?.[preset.id];
  const baseUrl = (saved?.baseUrl?.trim() || preset.baseUrl).replace(/\/+$/, '');
  let name = preset.name;
  if (preset.id === 'custom') {
    try {
      name = new URL(baseUrl).host;
    } catch {
      name = 'the custom server';
    }
  }
  return { preset, name, baseUrl, apiKey: saved?.apiKey?.trim() ?? '', model: saved?.model?.trim() ?? '', local: isLocal(baseUrl) };
}

// The name the panel shows for whichever connection is selected.
export function providerName(settings: ClaudeSettings): string {
  if (settings.mode === 'codex') return 'Codex';
  return usesProvider(settings) ? target(settings).name : 'Claude';
}

export function codexModel(settings: ClaudeSettings): string {
  return settings.providers?.[CODEX_LOCAL]?.model?.trim() ?? '';
}

export function activeModel(settings: ClaudeSettings): string {
  if (settings.mode === 'codex') return codexModel(settings) || 'Codex default';
  return usesProvider(settings) ? target(settings).model : settings.model;
}

// Local models often wrap the JSON in reasoning tags, a code fence or a sentence of preamble.
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Falls through to the error below.
      }
    }
  }
  throw new Error('The model replied with something other than JSON. Try again or pick a larger model.');
}

function checkReady(to: Target, needsModel: boolean): void {
  if (!to.baseUrl) throw new Error('Add a base URL for the server under Profile and logs.');
  if (to.preset.needsKey && !to.apiKey) throw new Error(`Add your ${to.name} API key under Profile and logs.`);
  if (needsModel && !to.model) throw new Error(`Pick a model for ${to.name} under Profile and logs.`);
}

async function send(to: Target, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (to.apiKey) headers.Authorization = `Bearer ${to.apiKey}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(`${to.baseUrl}${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(to.local
      ? `Could not reach ${to.name} at ${to.baseUrl}. Check that it is running.`
      : `Could not reach ${to.name}. Check your connection and the base URL.`);
  }
}

async function failure(to: Target, response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await response.json();
    const found = body?.error?.message ?? body?.error ?? body?.message;
    if (typeof found === 'string') detail = found;
  } catch {
    // Some servers send an empty or plain text error body.
  }
  const status = response.status;
  if (status === 401) return new Error(`${to.name} rejected the API key. Check it under Profile and logs.`);
  if (status === 403 && to.preset.id === 'ollama') return new Error('Ollama refused this extension. Set the OLLAMA_ORIGINS environment variable to chrome-extension://* and restart Ollama.');
  if (status === 403 && to.local) return new Error(`${to.name} refused this extension. Turn on CORS in its server settings and try again.`);
  if (status === 403) return new Error(`This ${to.name} API key does not have access to that model.`);
  if (status === 404) return new Error(`${to.name} does not recognize that model, or the base URL is wrong.`);
  if (status === 429) return new Error(`${to.name} is rate limiting this key or its quota has run out. Wait a minute and try again.`);
  return new Error(`${to.name} returned error ${status}${detail ? `: ${detail}` : '.'}`);
}

function replyText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

export async function askProvider(settings: ClaudeSettings, request: ClaudeRequest): Promise<unknown> {
  const to = target(settings);
  checkReady(to, true);
  // Many local servers ignore response_format without saying so, so the schema also goes in the prompt.
  const system = `${request.system}\n\nReply with one JSON object and nothing else. It must match this JSON schema:\n${JSON.stringify(request.schema)}`;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: request.prompt }];
  // Servers differ in which output formats they accept, so each rejection falls back to a looser one.
  const formats = [
    { type: 'json_schema', json_schema: { name: 'review', schema: request.schema, strict: true } },
    { type: 'json_object' },
    undefined,
  ];
  let response: Response | undefined;
  for (const format of formats) {
    response = await send(to, '/chat/completions', { model: to.model, messages, ...(format ? { response_format: format } : {}) });
    if (response.status !== 400 && response.status !== 422) break;
  }
  if (!response?.ok) throw await failure(to, response as Response);
  const choice = (await response.json())?.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`${to.name} declined to answer these questions.`);
  if (choice?.finish_reason === 'length') throw new Error(`${to.name} ran out of room before finishing. Try again with fewer fields on the page.`);
  const text = replyText(choice?.message?.content);
  if (!text.trim()) throw new Error(`${to.name} returned an empty reply.`);
  return extractJson(text);
}

export async function listModels(settings: ClaudeSettings): Promise<string[]> {
  const to = target(settings);
  checkReady(to, false);
  const response = await send(to, '/models');
  if (!response.ok) throw await failure(to, response);
  const body = await response.json();
  const list: unknown[] = Array.isArray(body) ? body : body?.data ?? body?.models ?? [];
  return list.flatMap((item) => {
    const id = typeof item === 'string' ? item : (item as { id?: unknown })?.id;
    return typeof id === 'string' ? [id] : [];
  }).sort();
}

// Hosted providers list models that can't answer a chat request. These words mark the common ones.
const NOT_CHAT = /embed|tts|whisper|audio|speech|transcri|image|dall-e|moderation|realtime|rerank|guard|vision-preview/i;

export function chatModels(ids: string[]): string[] {
  const chat = ids.filter((id) => !NOT_CHAT.test(id));
  return chat.length ? chat : ids;
}

// Listing models generates no text, so this check uses no tokens.
export async function testProvider(settings: ClaudeSettings): Promise<{ message: string; models: string[] }> {
  const to = target(settings);
  const models = chatModels(await listModels(settings));
  let message = `${to.name} is working and has ${to.model}.`;
  if (!to.model) message = `Reached ${to.name} and found ${models.length} model(s). Pick one in the Model box, then save.`;
  else if (!models.includes(to.model)) message = `Reached ${to.name}, but its list of ${models.length} model(s) does not include ${to.model}.`;
  return { message, models };
}
