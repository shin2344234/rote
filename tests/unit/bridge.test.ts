import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HOST = path.resolve('bridge/host.ps1');
const FAKE_CODEX = path.resolve('tests/fixtures/fake-codex.mjs');
const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

// Speaks Chrome's native messaging framing to the host, which is a four byte length and then JSON.
// It starts the host the way host.bat does, in the Windows PowerShell that ships with Windows.
function callHost(message: Record<string, unknown>, env: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HOST];
    const child = spawn(POWERSHELL, args, { env: { ...process.env, CODEX_BIN: FAKE_CODEX, CLAUDE_BIN: 'no-such-claude-binary', ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', () => {
      const all = Buffer.concat(chunks);
      resolve(JSON.parse(all.subarray(4, 4 + all.readUInt32LE(0)).toString('utf8')));
    });
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([length, body]));
  });
}

const ASK = { type: 'ask', engine: 'codex', system: 'Answer from the profile.', prompt: 'The questions.', schema: { type: 'object' } };

describe.skipIf(process.platform !== 'win32')('bridge host with Codex', () => {
  it('reports the Codex version on a ping', async () => {
    expect(await callHost({ type: 'ping', engine: 'codex' })).toEqual({ ok: true, version: 'codex-cli 9.9.9' });
  });

  it('says which tools this PC has without running either one', async () => {
    expect(await callHost({ type: 'status' })).toEqual({ ok: true, claude: { found: false }, codex: { found: true, version: 'codex-cli 9.9.9' } });
  });

  it('runs Codex read-only in an empty folder and returns its structured answer', async () => {
    const reply = await callHost({ ...ASK, model: 'some-model' });
    expect(reply.ok).toBe(true);
    const { args, stdin, schema, cwd } = reply.result.seen;
    expect(reply.result.answers).toEqual([]);
    expect(args[0]).toBe('exec');
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check']));
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args[args.indexOf('--model') + 1]).toBe('some-model');
    expect(args.at(-1)).toBe('-');
    expect(stdin).toBe('Answer from the profile.\n\nThe questions.');
    expect(schema).toEqual({ type: 'object' });
    expect(args[args.indexOf('--cd') + 1]).toBe(cwd);
    expect(existsSync(cwd)).toBe(false);
    expect(existsSync(args[args.indexOf('--output-schema') + 1])).toBe(false);
  });

  it('leaves the model to Codex when none is set', async () => {
    const reply = await callHost({ ...ASK, model: '' });
    expect(reply.result.seen.args).not.toContain('--model');
  });

  it('rejects a model name that could carry extra arguments', async () => {
    const reply = await callHost({ ...ASK, model: 'x --dangerously-bypass-approvals-and-sandbox' });
    expect(reply).toEqual({ ok: false, error: 'The bridge received an invalid model name.' });
  });

  it('explains a failed run and a reply that is not JSON', async () => {
    const failed = await callHost({ ...ASK, prompt: 'FAIL' });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('Codex exited with code 1 and no answer');
    expect(failed.error).toContain('not signed in');
    const garbled = await callHost({ ...ASK, prompt: 'GARBLE' });
    expect(garbled.error).toContain('Codex returned something other than JSON');
  });

  it('passes quotes, backslashes, spaces and non-ASCII text through unchanged', async () => {
    const system = 'Say "hi" to C:\\path with spaces\\ and \\"this\\" é ✓';
    const schema = { type: 'object', properties: { note: { type: 'string', description: 'a "quoted" \\ value' } }, required: ['note'] };
    const reply = await callHost({ ...ASK, system, prompt: 'Line one\nline two', schema });
    expect(reply.result.seen.stdin).toBe(`${system}\n\nLine one\nline two`);
    expect(reply.result.seen.schema).toEqual(schema);
  });

  it('refuses a script shim that would run through cmd.exe', async () => {
    const reply = await callHost({ type: 'ping', engine: 'codex' }, { CODEX_BIN: 'C:\\fake\\codex.cmd' });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('can only start a program file');
  });

  it('says Claude Code is missing when it cannot start it', async () => {
    const reply = await callHost({ type: 'ping', engine: 'claude' });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('Could not start Claude Code at no-such-claude-binary');
  });

  it('rejects an unknown request', async () => {
    expect(await callHost({ type: 'nope' })).toEqual({ ok: false, error: 'The bridge received an unknown request.' });
  });
});
