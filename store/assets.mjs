// Renders the extension icons into static/icons and the Chrome Web Store images into store/out.
// Run `npm run build` first, then `node store/assets.mjs`. Everyone in the screenshots is made up.
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FONTS } from '../relay/src/fonts.js';

const OUT = path.resolve('store/out');
const ICONS = path.resolve('static/icons');
mkdirSync(OUT, { recursive: true });
mkdirSync(ICONS, { recursive: true });

const fontCss = `
  @font-face { font-family: "League Gothic"; src: url(data:font/woff2;base64,${FONTS['/fonts/league-gothic.woff2']}) format("woff2"); }
  @font-face { font-family: "Public Sans"; src: url(data:font/woff2;base64,${FONTS['/fonts/public-sans.woff2']}) format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; background: transparent; }
`;

const browser = await chromium.launch({ channel: 'chromium' });

async function render(html, width, height, file, transparent = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><style>${fontCss}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}

// The 128 icon keeps 16 pixels of clear space on each side, as the store asks. Small sizes fill the square.
const icon = (size, pad) => {
  const box = size - pad * 2;
  return `<div style="position:absolute;left:${pad}px;top:${pad}px;width:${box}px;height:${box}px;border-radius:${Math.round(box * 0.2)}px;background:#0d0e10;display:grid;place-items:center">
    <span style="font-family:'League Gothic';color:#ffc91f;font-size:${Math.round(box * 0.92)}px;line-height:1;transform:translateY(${Math.round(box * 0.03)}px)">R</span></div>`;
};
for (const [size, pad] of [[16, 0], [32, 0], [48, 2], [128, 16]]) {
  await render(icon(size, pad), size, size, path.join(ICONS, `${size}.png`), true);
}
await render(icon(128, 16), 128, 128, path.join(OUT, 'icon-128.png'), true);

await render(`<div style="width:440px;height:280px;background:#0d0e10;color:#f4f5f6;box-sizing:border-box;padding:34px 36px;display:flex;flex-direction:column;justify-content:space-between">
  <div style="font-family:'League Gothic';color:#ffc91f;font-size:120px;line-height:.85">Rote</div>
  <div style="font-family:'Public Sans';font-size:22px;line-height:1.25;font-weight:500">Fills job applications<br>from your resume.</div></div>`, 440, 280, path.join(OUT, 'promo-small.png'));

await render(`<div style="width:1400px;height:560px;background:#0d0e10;color:#f4f5f6;box-sizing:border-box;padding:80px 96px;display:flex;align-items:center;gap:80px">
  <div style="font-family:'League Gothic';color:#ffc91f;font-size:300px;line-height:.8">Rote</div>
  <div style="font-family:'Public Sans';font-size:40px;line-height:1.25;font-weight:500">Fills job applications on any site from your resume. Free and open source.</div></div>`, 1400, 560, path.join(OUT, 'promo-marquee.png'));

// Screenshots: a made-up applicant, a made-up employer page, and the real extension from dist.
const LINES = [
  'Jordan Avery', 'Austin, TX 78701 | (512) 555-0147 | jordan.avery@example.com', 'linkedin.com/in/jordan-avery', '',
  'EXPERIENCE', 'Operations Coordinator, Lakeside Logistics   Jan 2021 - Present', '- Planned routes for a fleet of 40 trucks.', '',
  'EDUCATION', 'University of Texas at Austin', 'Bachelor of Business Administration, 2014 - 2018', '', 'SKILLS', 'Excel, SQL, route planning',
];
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const sheet = pdf.addPage([612, 792]);
LINES.forEach((text, index) => text && sheet.drawText(text, { x: 50, y: 740 - index * 18, size: 11, font }));
const resume = path.join(OUT, 'jordan-avery.pdf');
writeFileSync(resume, await pdf.save());

const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(readFileSync('store/demo.html')); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const demoUrl = `http://127.0.0.1:${server.address().port}/apply`;

const dist = path.resolve('dist');
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const id = worker.url().split('/')[2];

const options = await context.newPage();
await options.goto(`chrome-extension://${id}/options.html`);
await options.setInputFiles('#upload', resume);
await options.locator('#parse-result').filter({ hasText: 'Parsed' }).waitFor();
await options.selectOption('[data-key=workAuthorized]', 'yes');
await options.selectOption('[data-key=sponsorship]', 'no');
await options.click('#save');
await options.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
await options.evaluate(() => window.scrollTo(0, 0));
await options.screenshot({ path: path.join(OUT, 'screenshot-2-profile.png') });

const target = await context.newPage();
await target.setViewportSize({ width: 860, height: 800 });
await target.goto(demoUrl);
const tabId = await options.evaluate(async (wanted) => (await chrome.tabs.query({})).find((tab) => tab.url === wanted)?.id, demoUrl);
const panel = await context.newPage();
await panel.setViewportSize({ width: 420, height: 800 });
await panel.goto(`chrome-extension://${id}/panel.html?tabId=${tabId}`);
await panel.click('#scan');
await panel.locator('#fill').and(panel.locator(':enabled')).waitFor();
await panel.click('#fill');
await panel.locator('#undo').and(panel.locator(':enabled')).waitFor({ timeout: 20000 });
await target.bringToFront();
const left = (await target.screenshot()).toString('base64');
const right = (await panel.screenshot()).toString('base64');

const shot = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await shot.setContent(`<!doctype html><body style="margin:0;display:flex;background:#fff">
  <img src="data:image/png;base64,${left}" style="width:860px;height:800px;display:block">
  <img src="data:image/png;base64,${right}" style="width:419px;height:800px;display:block;border-left:1px solid #c4ccd4"></body>`);
await shot.screenshot({ path: path.join(OUT, 'screenshot-1-fill.png') });

await context.close();
await browser.close();
server.close();
console.log(`Wrote icons to ${ICONS} and store images to ${OUT}`);
