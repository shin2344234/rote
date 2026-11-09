// Scan-only check against real public application forms. It never clicks Fill,
// so nothing is typed or uploaded. Run with LIVE_SCAN=1 npx playwright test live-scan.
import { test, chromium } from '@playwright/test';
import path from 'node:path';

async function liveUrls(): Promise<[string, string][]> {
  const json = async (url: string) => (await fetch(url)).json() as Promise<any>;
  const found: [string, string][] = [];
  const attempt = async (name: string, get: () => Promise<string>) => {
    try {
      found.push([name, await get()]);
    } catch (error) {
      console.log(`${name}: could not find a posting (${(error as Error).message})`);
    }
  };
  await attempt('greenhouse', async () => `https://job-boards.greenhouse.io/anthropic/jobs/${(await json('https://boards-api.greenhouse.io/v1/boards/anthropic/jobs')).jobs[0].id}`);
  await attempt('lever', async () => `${(await json('https://api.lever.co/v0/postings/spotify?mode=json&limit=1'))[0].hostedUrl}/apply`);
  await attempt('ashby', async () => `${(await json('https://api.ashbyhq.com/posting-api/job-board/ramp')).jobs[0].jobUrl}/application`);
  return found;
}

test('scan real forms', async () => {
  test.skip(!process.env.LIVE_SCAN, 'Set LIVE_SCAN=1 to run');
  test.setTimeout(180000);
  const dist = path.resolve('dist');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = worker.url().split('/')[2];

  for (const [name, url] of await liveUrls()) {
    const target = await context.newPage();
    await target.goto(url, { waitUntil: 'load' });
    await target.waitForTimeout(4000);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    const tabId = await panel.evaluate(async (host) => (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(host))?.id, new URL(target.url()).origin);
    console.log(`${name}: ${new URL(target.url()).origin}${new URL(target.url()).pathname} tab ${tabId}`);
    await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
    await panel.click('#scan');
    await panel.waitForSelector('#report .summary, #status .note', { timeout: 20000 });
    await panel.waitForTimeout(800);

    const rows: any[] = await panel.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('resume-autofill');
      open.onsuccess = () => {
        const all = open.result.transaction('logs').objectStore('logs').getAll();
        all.onsuccess = () => { open.result.close(); resolve(all.result); };
      };
    }));
    const note = await panel.locator('#status .note').textContent({ timeout: 500 }).catch(() => '');
    if (note) console.log(`${name} notice: ${note}`);
    const last = rows.filter((row) => row.event === 'scan.start').pop()?.runId;
    const fields = rows.filter((row) => row.runId === last && /^field\./.test(row.event));
    console.log(`\n== ${name}: ${fields.length} fields`);
    for (const { data } of fields) {
      const s = data.signals;
      console.log(`${(data.key || `(${data.status})`).padEnd(20)} ${data.score.toFixed(2)} ${data.kind.padEnd(9)} ${(s.label || s.ariaLabel || s.legend || s.nearby || s.name || s.id).slice(0, 70)}`);
    }
    await target.close();
    await panel.close();
  }
  await context.close();
});

// Fills contact fields on one real form with made-up data, then reads them again over
// the next few seconds to catch values the page drops. Nothing is uploaded or submitted.
test('filled values stay on a real form', async () => {
  const url = process.env.LIVE_STICK;
  test.skip(!url, 'Set LIVE_STICK to a form URL to run');
  test.setTimeout(120000);
  const dist = path.resolve('dist');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = worker.url().split('/')[2];

  const target = await context.newPage();
  await target.goto(url!, { waitUntil: 'load' });
  await target.waitForTimeout(8000);
  const guest = target.getByText('Apply without an Account');
  if (await guest.count()) {
    await guest.first().click();
    await target.waitForTimeout(8000);
  }
  console.log('landed on', target.url(), 'inputs', await target.locator('input').count());
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.evaluate(() => new Promise<void>((resolve) => {
    const open = indexedDB.open('resume-autofill');
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({
        fields: { firstName: 'Testa', lastName: 'Sample', email: 'testa.sample@example.com', phone: '5125550142', linkedin: 'https://www.linkedin.com/in/testa-sample', addressLine1: '100 Sample St', city: 'Austin', state: 'Texas', postalCode: '78701' },
        work: [], education: [], skills: [], updatedAt: Date.now(),
      }, 'profile');
      tx.oncomplete = () => { open.result.close(); resolve(); };
    };
  }));
  const tabId = await panel.evaluate(async (host) => (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(host))?.id, new URL(target.url()).origin);
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  await panel.click('#scan');
  await panel.waitForSelector('#fill:not([disabled])', { timeout: 20000 });
  await panel.click('#fill');
  await panel.waitForSelector('#undo:not([disabled])', { timeout: 60000 });

  const read = () => target.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),textarea'))
    .filter((input) => input.value).map((input) => `${input.id || input.name}=${input.value}`));
  for (const wait of [0, 2000, 4000, 8000]) {
    await target.waitForTimeout(wait);
    console.log(`after +${wait}ms`, JSON.stringify(await read()));
  }
  const logs: any[] = await panel.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('resume-autofill');
    open.onsuccess = () => {
      const all = open.result.transaction('logs').objectStore('logs').getAll();
      all.onsuccess = () => { open.result.close(); resolve(all.result); };
    };
  }));
  for (const { data } of logs.filter((row) => row.event === 'field.result')) console.log(data.key, data.kind, data.ok, data.detail, data.chosen ?? '');
  const framework = await target.evaluate(() => ({ title: document.title, url: location.pathname, inputs: document.querySelectorAll('input').length, react: Boolean(document.querySelector('[data-reactroot]')) || Object.keys(document.querySelector('input') ?? {}).some((key) => key.startsWith('__react')) }));
  console.log(JSON.stringify(framework));
  await context.close();
});

// Fills education on one real form in a throwaway browser with made-up data. No resume
// is stored, so nothing is uploaded, and Submit is never clicked.
test('fill education on a real form', async () => {
  const url = process.env.LIVE_FILL;
  test.skip(!url, 'Set LIVE_FILL to a posting URL to run');
  test.setTimeout(120000);
  const dist = path.resolve('dist');
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = worker.url().split('/')[2];

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('[data-section="Education"] button', { hasText: 'Add' }).click();
  const inputs = options.locator('[data-section="Education"] .entry input');
  for (const [index, value] of [[0, 'University of Texas at Austin'], [1, 'Bachelor of Science'], [2, 'Computer Science'], [4, '2014-09'], [5, '2018-05']] as const) await inputs.nth(index).fill(value);
  await options.click('#save');
  await options.waitForFunction(() => document.querySelector('#save-status')?.textContent === 'Saved');

  const target = await context.newPage();
  await target.goto(url!, { waitUntil: 'load' });
  await target.waitForTimeout(4000);
  const tabId = await options.evaluate(async (host) => (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(host))?.id, new URL(target.url()).origin);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  await panel.click('#scan');
  await panel.waitForSelector('#fill:not([disabled])', { timeout: 20000 });
  await panel.click('#fill');
  await panel.waitForSelector('#undo:not([disabled])', { timeout: 60000 });

  const values = await target.evaluate(() => Object.fromEntries(['school', 'degree', 'discipline', 'start-month', 'start-year', 'end-month', 'end-year'].map((name) => {
    const input = document.getElementById(`${name}--0`) as HTMLInputElement | null;
    const shown = input?.closest('.select__control')?.querySelector('.select__single-value')?.textContent;
    return [name, shown ?? input?.value ?? '(missing)'];
  })));
  console.log(JSON.stringify(values, null, 1));

  const logs: any[] = await panel.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('resume-autofill');
    open.onsuccess = () => {
      const all = open.result.transaction('logs').objectStore('logs').getAll();
      all.onsuccess = () => { open.result.close(); resolve(all.result); };
    };
  }));
  for (const { data } of logs.filter((row) => row.event === 'field.result' && /edu\./.test(row.data?.key ?? ''))) console.log(JSON.stringify(data));
  await context.close();
});
