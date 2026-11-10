// The site behind rote.walker-computers.com. It takes bug reports from the extension
// and files each one as an issue in a private GitHub repo. The GitHub token stays on
// the server, so it never ships inside the extension. The handler uses only web
// standard requests and responses, and server.mjs runs it under Node.
import { FONTS } from './fonts.js';
import { CONNECTED_PAGE, HOME_PAGE, PRIVACY_PAGE } from './pages.js';

export const MAX_ZIP_BYTES = 1_500_000;
export const MAX_BODY_BYTES = MAX_ZIP_BYTES + 100_000;
const MAX_DESCRIPTION = 5000;
const MAX_SHORT = 200;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = (html) => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });

// Report text comes from strangers, so it goes inside a code fence where it can't
// mention people, close the fence or render links.
function fenced(text) {
  return `~~~text\n${text.replaceAll('~~~', '~ ~ ~')}\n~~~`;
}

function oneLine(value, limit = MAX_SHORT) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function base64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function newId(now = new Date()) {
  const random = [...crypto.getRandomValues(new Uint8Array(4))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${now.toISOString().slice(0, 10).replaceAll('-', '')}-${random}`;
}

async function github(env, method, path, body) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rote-report-relay',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${method} ${path}`);
  return response.json();
}

// The zip names change with each version, so /download and /download-bridge look up the current ones.
// Answers are kept for ten minutes because GitHub limits unsigned lookups. Any failure lands on the releases page.
const SOURCE_REPO = 'shin2344234/rote';
const RELEASES_PAGE = `https://github.com/${SOURCE_REPO}/releases/latest`;
const EXTENSION_ZIP = /^rote-\d[\d.]*\.zip$/;
const BRIDGE_ZIP = /^rote-bridge-\d[\d.]*\.zip$/;
let latest = { assets: [], expires: 0 };

async function latestDownload(zipName, now = Date.now()) {
  if (now >= latest.expires) {
    let assets = [];
    try {
      const response = await fetch(`https://api.github.com/repos/${SOURCE_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'rote-site' },
      });
      if (response.ok) assets = (await response.json()).assets ?? [];
    } catch (error) {
      console.error(error.message);
    }
    latest = { assets, expires: now + (assets.length ? 600_000 : 60_000) };
  }
  return latest.assets.find((asset) => zipName.test(asset.name))?.browser_download_url ?? RELEASES_PAGE;
}

async function fileReport(request, env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return json(503, { error: 'Bug reports are not set up yet.' });
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'That report is too large.' });

  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.REPORT_LIMITER && !(await env.REPORT_LIMITER.limit({ key: address })).success) {
    return json(429, { error: 'Too many reports from this connection. Wait a minute and try again.' });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'The report was not readable.' });
  }
  // Browsers send form text with Windows line endings.
  const description = String(form.get('description') ?? '').replaceAll('\r\n', '\n').trim().slice(0, MAX_DESCRIPTION);
  const file = form.get('report');
  if (!description) return json(400, { error: 'Describe what went wrong before sending.' });
  if (!file || typeof file === 'string') return json(400, { error: 'The report file is missing.' });
  if (file.size > MAX_ZIP_BYTES) return json(413, { error: 'That report is too large.' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json(400, { error: 'The report file is not a zip.' });

  const id = newId();
  const zipPath = `reports/${id.slice(0, 6)}/${id}.zip`;
  const version = oneLine(form.get('version'), 40);
  const details = [
    `Report ID: ${id}`,
    `Version: ${version || 'not given'}`,
    `Browser: ${oneLine(form.get('browser')) || 'not given'}`,
    `Page host: ${oneLine(form.get('host')) || 'not given'}`,
    `Contact: ${oneLine(form.get('contact')) || 'not given'}`,
  ].join('\n');
  try {
    const saved = await github(env, 'PUT', `/contents/${zipPath}`, { message: `Add bug report ${id}`, content: base64(bytes) });
    const body = `${fenced(description)}\n\n${fenced(details)}\n\nLogs: ${saved.content?.html_url ?? zipPath}`;
    const title = `Bug report ${id}: ${oneLine(description, 70)}`;
    await github(env, 'POST', '/issues', { title, body });
  } catch (error) {
    console.error(error.message);
    return json(502, { error: 'The report could not be filed. Try again later.' });
  }
  return json(201, { id });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/report') {
      if (request.method !== 'POST') return json(405, { error: 'Send reports with POST.' });
      return fileReport(request, env);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed.' });
    if (pathname === '/') return page(HOME_PAGE);
    if (pathname === '/privacy') return page(PRIVACY_PAGE);
    if (pathname === '/download' || pathname === '/download-bridge') {
      const location = await latestDownload(pathname === '/download' ? EXTENSION_ZIP : BRIDGE_ZIP);
      return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
    }
    if (FONTS[pathname]) return new Response(Uint8Array.from(atob(FONTS[pathname]), (char) => char.charCodeAt(0)), { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    // OpenRouter sends the browser here after a sign-in. The extension reads the code from the tab and closes it.
    if (pathname === '/openrouter') return new Response(CONNECTED_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    return new Response('Not found', { status: 404 });
  },
};
