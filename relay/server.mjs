// Runs the relay under Node, for hosting in a container behind a Cloudflare Tunnel.
// The request handling lives in src/index.js and this file only adapts it to node:http.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import relay, { MAX_BODY_BYTES } from './src/index.js';

// Allows `limit` calls per key in each window. Old keys are dropped as new ones arrive.
export function createLimiter(limit = 5, windowMs = 60000, now = Date.now) {
  const seen = new Map();
  return {
    async limit({ key }) {
      const time = now();
      for (const [other, entry] of seen) if (time - entry.start >= windowMs) seen.delete(other);
      const entry = seen.get(key) ?? { start: time, count: 0 };
      entry.count++;
      seen.set(key, entry);
      return { success: entry.count <= limit };
    },
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function createRelayServer(env) {
  return createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
      let body;
      try {
        body = hasBody ? await readBody(incoming) : undefined;
      } catch {
        outgoing.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"That report is too large."}');
        return;
      }
      const request = new Request(`https://${incoming.headers.host ?? 'localhost'}${incoming.url}`, { method: incoming.method, headers, body });
      const response = await relay.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end('{"error":"The report server failed."}');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8787);
  const env = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPO: process.env.GITHUB_REPO, REPORT_LIMITER: createLimiter() };
  createRelayServer(env).listen(port, () => {
    console.log(`Rote relay listening on ${port}. Reports go to ${env.GITHUB_REPO ?? 'nowhere'}${env.GITHUB_TOKEN ? '' : ', and no GitHub token is set'}.`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
}
