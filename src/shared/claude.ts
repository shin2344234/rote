// Sends a request to Claude over the API, to Claude Code or Codex through the local bridge, or to another provider.
import Anthropic from '@anthropic-ai/sdk';
import { askProvider, codexModel, testProvider, usesProvider } from './providers';
import type { ClaudeSettings } from './types';

export const BRIDGE_HOST = 'com.resume_autofill.claude';
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MODELS: [string, string][] = [['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5']];

export interface ClaudeRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
}

interface BridgeReply {
  ok: boolean;
  result?: unknown;
  version?: string;
  error?: string;
}

function apiClient(settings: ClaudeSettings): Anthropic {
  if (!settings.apiKey) throw new Error('Add your Anthropic API key under Profile and logs.');
  return new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
}

function apiFailure(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) return new Error('Claude rejected the API key. Check it under Profile and logs.');
  if (error instanceof Anthropic.PermissionDeniedError) return new Error('This API key does not have access to that model.');
  if (error instanceof Anthropic.NotFoundError) return new Error('Claude does not recognize that model.');
  if (error instanceof Anthropic.RateLimitError) return new Error('Claude is rate limiting this API key. Wait a minute and try again.');
  if (error instanceof Anthropic.APIConnectionError) return new Error('Could not reach Claude. Check your connection.');
  if (error instanceof Anthropic.APIError) return new Error(`Claude returned error ${error.status}: ${error.message}`);
  return error as Error;
}

async function askApi(settings: ClaudeSettings, request: ClaudeRequest): Promise<unknown> {
  const client = apiClient(settings);
  const fallback = settings.model.startsWith('claude-opus-5')
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {};
  let message;
  try {
    message = await client.beta.messages.create({
      model: settings.model,
      max_tokens: 16000,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      output_config: { effort: 'high', format: { type: 'json_schema', schema: request.schema } },
      ...fallback,
    });
  } catch (error) {
    throw apiFailure(error);
  }
  if (message.stop_reason === 'refusal') throw new Error('Claude declined to answer these questions.');
  if (message.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing. Try again with fewer fields on the page.');
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  return JSON.parse(text);
}

async function callBridge(message: Record<string, unknown>): Promise<BridgeReply> {
  let reply: BridgeReply | undefined;
  try {
    reply = await chrome.runtime.sendNativeMessage(BRIDGE_HOST, message) as BridgeReply;
  } catch (error) {
    const text = (error as Error).message ?? String(error);
    if (/not found/i.test(text)) throw new Error('The local bridge is not installed. Run bridge\\install.ps1 and try again.');
    if (/forbidden/i.test(text)) throw new Error('The bridge does not allow this extension ID. Run bridge\\install.ps1 again with -ExtensionId.');
    throw new Error(`The local bridge failed: ${text}`);
  }
  if (!reply?.ok) throw new Error(reply?.error ?? 'The local bridge returned nothing.');
  return reply;
}

export interface ToolStatus {
  found: boolean;
  version?: string;
}

export type BridgeStatus =
  | { state: 'ready'; claude: ToolStatus; codex: ToolStatus }
  | { state: 'missing' | 'wrong-id' | 'failed'; detail: string };

// Starts no model run. The host only asks each tool for its version.
export async function bridgeStatus(): Promise<BridgeStatus> {
  try {
    const reply = await chrome.runtime.sendNativeMessage(BRIDGE_HOST, { type: 'status' }) as BridgeReply & { claude?: ToolStatus; codex?: ToolStatus };
    if (!reply?.ok) return { state: 'failed', detail: reply?.error ?? 'The local bridge returned nothing.' };
    return { state: 'ready', claude: reply.claude ?? { found: false }, codex: reply.codex ?? { found: false } };
  } catch (error) {
    const detail = (error as Error).message ?? String(error);
    if (/not found/i.test(detail)) return { state: 'missing', detail };
    if (/forbidden/i.test(detail)) return { state: 'wrong-id', detail };
    return { state: 'failed', detail };
  }
}

export async function askClaude(settings: ClaudeSettings, request: ClaudeRequest): Promise<unknown> {
  if (settings.mode === 'api') return askApi(settings, request);
  if (settings.mode === 'bridge') return (await callBridge({ type: 'ask', model: settings.model, ...request })).result;
  if (settings.mode === 'codex') return (await callBridge({ type: 'ask', engine: 'codex', model: codexModel(settings), ...request })).result;
  if (usesProvider(settings)) return askProvider(settings, request);
  throw new Error('Turn on an AI connection under Profile and logs.');
}

// Neither check generates any text, so neither uses up tokens.
export async function testClaude(settings: ClaudeSettings): Promise<string> {
  if (settings.mode === 'bridge') return `Bridge is working with Claude Code ${(await callBridge({ type: 'ping' })).version}.`;
  if (settings.mode === 'codex') return `Bridge is working with ${(await callBridge({ type: 'ping', engine: 'codex' })).version}.`;
  if (usesProvider(settings)) return (await testProvider(settings)).message;
  if (settings.mode !== 'api') return 'AI review is off.';
  try {
    const model = await apiClient(settings).models.retrieve(settings.model);
    return `API key works with ${model.display_name}.`;
  } catch (error) {
    throw apiFailure(error);
  }
}
