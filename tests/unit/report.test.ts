import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { MAX_ZIP_BYTES } from '../../relay/src/index.js';
import { buildReport, previewText, REPORT_URL, sendReport, zipReport } from '../../src/shared/report';
import type { ClaudeSettings, LogEntry } from '../../src/shared/types';

const SETTINGS: ClaudeSettings = { mode: 'openai', apiKey: 'secret-anthropic-key', model: 'claude-opus-5-5', provider: 'ollama', providers: { ollama: { apiKey: 'secret-other-key', model: 'local-model', baseUrl: '' } } };
const LOGS: LogEntry[] = [
  { ts: 1, level: 'info', scope: 'panel', event: 'scan.start', data: { frameUrl: 'https://jobs.example.com/apply/123?token=abc' } },
  // Written while debug logging was on, so the value is stored in full.
  { ts: 2, level: 'debug', scope: 'fill', event: 'field.result', data: { label: 'Email address', value: 'jordan@example.com', chosen: 'Texas' } },
];
const input = (over: Partial<Parameters<typeof buildReport>[0]> = {}) =>
  ({ description: '  The state list stayed empty.  ', contact: 'me@example.com', logs: LOGS, settings: SETTINGS, version: '0.1.0', browser: 'TestBrowser/1', ...over });

afterEach(() => vi.unstubAllGlobals());

describe('buildReport', () => {
  it('removes personal values, keys and URL queries, and keeps field structure', () => {
    const report = buildReport(input());
    const text = previewText(report);
    expect(text).not.toContain('jordan@example.com');
    expect(text).not.toContain('Texas');
    expect(text).not.toContain('token=abc');
    expect(text).not.toContain('secret-');
    expect(text).toContain('Email address');
    expect(text).toContain('The state list stayed empty.');
    expect(report.summary).toMatchObject({
      description: 'The state list stayed empty.', contact: 'me@example.com', version: '0.1.0', host: 'jobs.example.com',
      ai: { connection: 'openai', provider: 'Ollama', model: 'local-model' }, logEntries: 2,
    });
  });

  it('keeps only the newest entries and names no provider when AI is off', () => {
    const many = Array.from({ length: 3500 }, (_, index): LogEntry => ({ ts: index, level: 'info', scope: 'fill', event: 'e', data: { index } }));
    const report = buildReport(input({ logs: many, settings: { ...SETTINGS, mode: 'off' } }));
    expect(report.logLines).toHaveLength(3000);
    expect(report.logLines[0]).toContain('"index":500');
    expect(report.summary.ai).toEqual({ connection: 'off', provider: '', model: '' });
    expect(report.summary.host).toBe('');
  });

  it('zips the summary and the log', async () => {
    const report = buildReport(input());
    const zip = await JSZip.loadAsync(await (await zipReport(report)).arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['logs.jsonl', 'report.json']);
    expect(JSON.parse(await zip.file('report.json')!.async('string')).version).toBe('0.1.0');
    expect((await zip.file('logs.jsonl')!.async('string')).split('\n')).toHaveLength(2);
  });
});

describe('sendReport', () => {
  it('posts the form to the relay and returns the report ID', async () => {
    const calls: { url: string; form: FormData }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, form: init.body as FormData });
      return new Response(JSON.stringify({ id: '20261109-abcd1234' }), { status: 201 });
    });
    expect(await sendReport(buildReport(input()))).toBe('20261109-abcd1234');
    expect(calls[0].url).toBe(REPORT_URL);
    expect(calls[0].form.get('description')).toBe('The state list stayed empty.');
    expect(calls[0].form.get('host')).toBe('jobs.example.com');
    expect((calls[0].form.get('report') as File).size).toBeGreaterThan(100);
  });

  it('explains an empty description, a server error and a dead connection', async () => {
    await expect(sendReport(buildReport(input({ description: ' ' })))).rejects.toThrow('Describe what went wrong');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Too many reports from this connection.' }), { status: 429 }));
    await expect(sendReport(buildReport(input()))).rejects.toThrow('Too many reports');
    vi.stubGlobal('fetch', async () => new Response('<html>down</html>', { status: 503 }));
    await expect(sendReport(buildReport(input()))).rejects.toThrow('error 503');
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(sendReport(buildReport(input()))).rejects.toThrow('Could not reach the report server');
  });
});

describe('relay worker', () => {
  const ENV = { GITHUB_TOKEN: 'fake-github-token', GITHUB_REPO: 'someone/rote-reports', REPORT_LIMITER: { limit: async () => ({ success: true }) } };
  const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);

  function post(fields: Record<string, string | Blob>, headers: Record<string, string> = {}): Request {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return new Request('https://rote.walker-computers.com/report', { method: 'POST', body: form, headers });
  }

  function stubGithub(status = 201) {
    const calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method!, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ content: { html_url: 'https://github.com/someone/rote-reports/blob/main/x.zip' } }), { status });
    });
    return calls;
  }

  it('stores the zip and opens an issue that cannot mention anyone', async () => {
    const calls = stubGithub();
    const response = await worker.fetch(post({
      description: 'It broke.\n~~~\n@someone see [this](https://evil.example)', version: '0.1.0', browser: 'TestBrowser/1', host: 'jobs.example.com', contact: '', report: new Blob([ZIP]),
    }), ENV);
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    expect(id).toMatch(/^\d{8}-[0-9a-f]{8}$/);

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(`https://api.github.com/repos/someone/rote-reports/contents/reports/${id.slice(0, 6)}/${id}.zip`);
    expect(calls[0].headers.Authorization).toBe('Bearer fake-github-token');
    expect(Buffer.from(calls[0].body.content, 'base64')).toEqual(Buffer.from(ZIP));
    expect(calls[1].url).toBe('https://api.github.com/repos/someone/rote-reports/issues');
    expect(calls[1].body.title).toBe(`Bug report ${id}: It broke. ~~~ @someone see [this](https://evil.example)`.slice(0, `Bug report ${id}: `.length + 70));
    const body = calls[1].body.body as string;
    expect(body.startsWith('~~~text\nIt broke.\n~ ~ ~\n@someone')).toBe(true);
    expect(body.match(/^~~~/gm)).toHaveLength(4);
    expect(body).toContain('Page host: jobs.example.com');
    expect(body).toContain('Logs: https://github.com/someone/rote-reports/blob/main/x.zip');
  });

  it('turns away bad, oversized and too frequent reports without calling GitHub', async () => {
    const calls = stubGithub();
    const status = async (request: Request, env: object = ENV) => (await worker.fetch(request, env)).status;
    expect(await status(post({ description: '', report: new Blob([ZIP]) }))).toBe(400);
    expect(await status(post({ description: 'x' }))).toBe(400);
    expect(await status(post({ description: 'x', report: new Blob(['not a zip']) }))).toBe(400);
    expect(await status(post({ description: 'x', report: new Blob([new Uint8Array(MAX_ZIP_BYTES + 1).fill(0x50)]) }))).toBe(413);
    expect(await status(post({ description: 'x', report: new Blob([ZIP]) }), { ...ENV, REPORT_LIMITER: { limit: async () => ({ success: false }) } })).toBe(429);
    expect(await status(post({ description: 'x', report: new Blob([ZIP]) }), { GITHUB_REPO: 'someone/rote-reports' })).toBe(503);
    expect(await status(new Request('https://rote.walker-computers.com/report'))).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('hides GitHub failures from the sender', async () => {
    stubGithub(401);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await worker.fetch(post({ description: 'x', report: new Blob([ZIP]) }), ENV);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('401');
  });

  it('serves the home and privacy pages', async () => {
    const home = await worker.fetch(new Request('https://rote.walker-computers.com/'), ENV);
    expect(await home.text()).toContain('Stop retyping your resume into every job application.');
    const privacy = await worker.fetch(new Request('https://rote.walker-computers.com/privacy'), ENV);
    expect(await privacy.text()).toContain('What leaves your browser');
    expect((await worker.fetch(new Request('https://rote.walker-computers.com/nope'), ENV)).status).toBe(404);
  });

  it('serves its own fonts as binary files', async () => {
    const font = await worker.fetch(new Request('https://rote.walker-computers.com/fonts/league-gothic.woff2'), ENV);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect(new TextDecoder().decode((await font.arrayBuffer()).slice(0, 4))).toBe('wOF2');
  });

  it('sends each download route to its own zip', async () => {
    let lookups = 0;
    vi.stubGlobal('fetch', async () => {
      lookups += 1;
      return new Response(JSON.stringify({ assets: [
        { name: 'rote-bridge-9.9.9.zip', browser_download_url: 'https://example.com/bridge.zip' },
        { name: 'rote-9.9.9.zip', browser_download_url: 'https://example.com/rote.zip' },
      ] }));
    });
    const request = () => worker.fetch(new Request('https://rote.walker-computers.com/download'), ENV);
    const first = await request();
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('https://example.com/rote.zip');
    expect((await request()).headers.get('location')).toBe('https://example.com/rote.zip');
    const bridge = await worker.fetch(new Request('https://rote.walker-computers.com/download-bridge'), ENV);
    expect(bridge.status).toBe(302);
    expect(bridge.headers.get('location')).toBe('https://example.com/bridge.zip');
    expect(lookups).toBe(1);
  });
});

describe('relay under Node', () => {
  it('serves pages, refuses oversized bodies and limits repeat senders', async () => {
    const { createLimiter, createRelayServer } = await import('../../relay/server.mjs');
    let clock = 0;
    const limiter = createLimiter(2, 1000, () => clock);
    expect((await limiter.limit({ key: 'a' })).success).toBe(true);
    expect((await limiter.limit({ key: 'a' })).success).toBe(true);
    expect((await limiter.limit({ key: 'a' })).success).toBe(false);
    expect((await limiter.limit({ key: 'b' })).success).toBe(true);
    clock = 1000;
    expect((await limiter.limit({ key: 'a' })).success).toBe(true);

    const server = createRelayServer({ GITHUB_REPO: 'someone/rote-reports' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const home = await fetch(`${base}/`);
      expect(home.headers.get('content-type')).toContain('text/html');
      expect(await home.text()).toContain('buymeacoffee.com/SethWalker234');
      const form = new FormData();
      form.set('description', 'x');
      form.set('report', new Blob([new Uint8Array([0x50, 0x4b, 3, 4])]), 'report.zip');
      const unset = await fetch(`${base}/report`, { method: 'POST', body: form });
      expect(unset.status).toBe(503);
      expect(await unset.json()).toEqual({ error: 'Bug reports are not set up yet.' });
      const huge = await fetch(`${base}/report`, { method: 'POST', body: new Uint8Array(MAX_ZIP_BYTES + 200_000) }).then((response) => response.status, () => 413);
      expect(huge).toBe(413);
    } finally {
      server.close();
    }
  });
});
