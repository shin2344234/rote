// Builds the two release downloads into release/. One is the extension, ready for
// Load unpacked. The other is the optional bridge for Claude Code and Codex.
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });
const { version } = JSON.parse(readFileSync('static/manifest.json', 'utf8'));

function addFolder(zip, folder, prefix, keep) {
  for (const name of readdirSync(folder)) {
    const full = path.join(folder, name);
    if (statSync(full).isDirectory()) addFolder(zip, full, `${prefix}${name}/`, keep);
    else if (keep(name)) zip.file(`${prefix}${name}`, readFileSync(full));
  }
}

async function write(name, fill) {
  const zip = new JSZip();
  fill(zip);
  const file = path.join('release', name);
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
  console.log(`${file}  ${Math.round(statSync(file).size / 1024)} KB`);
}

rmSync('release', { recursive: true, force: true });
mkdirSync('release');
// Source maps triple the download and Chrome does not need them.
await write(`rote-${version}.zip`, (zip) => addFolder(zip, 'dist', '', (name) => !name.endsWith('.map')));
// The generated launcher and manifest hold local paths, so only the two source files ship.
await write(`rote-bridge-${version}.zip`, (zip) => addFolder(zip, 'bridge', 'bridge/', (name) => name === 'host.mjs' || name === 'install.ps1'));
