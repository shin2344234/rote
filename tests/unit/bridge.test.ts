import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HOST = path.resolve('bridge/host.mjs');
const FAKE_CODEX = path.resolve('tests/fixtures/fake-codex.mjs');

// Speaks Chrome's native messaging framing to the host, which is a four byte length and then JSON.
function callHost(message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST], { env: { ...process.env, CODEX_BIN: FAKE_CODEX, CLAUDE_BIN: 'no-such-claude-binary' }, stdio: ['pipe', 'pipe', 'inherit'] });
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

describe('bridge host with Codex', () => {
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
});
