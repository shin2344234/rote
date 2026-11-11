// Bundles the extension into dist/. Load dist/ as an unpacked extension.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('static', 'dist', { recursive: true });
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf.worker.min.mjs');

// The panel and options page use the site's two fonts. They come from the relay's
// base64 copies so the extension and the site cannot drift apart.
const { FONTS } = await import('./relay/src/fonts.js');
mkdirSync('dist/fonts', { recursive: true });
for (const [route, data] of Object.entries(FONTS)) writeFileSync(`dist${route}`, Buffer.from(data, 'base64'));
cpSync('relay/FONT-LICENSES.txt', 'dist/fonts/FONT-LICENSES.txt');

const shared = { bundle: true, target: 'chrome120', sourcemap: 'linked', logLevel: 'info', platform: 'browser' };

const builds = [
  // Injected with chrome.scripting, so it must be one classic script.
  { ...shared, entryPoints: { content: 'src/content/index.ts' }, outdir: 'dist', format: 'iife' },
  {
    ...shared,
    entryPoints: { background: 'src/background/index.ts', panel: 'src/ui/panel.ts', options: 'src/ui/options.ts', applications: 'src/ui/applications.ts' },
    outdir: 'dist',
    format: 'esm',
  },
];

if (watch) {
  for (const options of builds) (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
