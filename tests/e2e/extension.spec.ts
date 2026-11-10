import { test as base, expect, chromium, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const BASE = 'http://localhost:4173/tests/fixtures';
const WORK = path.resolve('test-results/generated');
const EMAIL = 'jordan.avery@example.com';

const LINES = [
  'Jordan Avery',
  `123 Maple Street, Austin, TX 78701 | (512) 555-0147 | ${EMAIL}`,
  'linkedin.com/in/jordan-avery',
  '',
  'SUMMARY',
  'Backend engineer focused on payments.',
  '',
  'EXPERIENCE',
  'Senior Software Engineer, Acme Corp   Jan 2021 - Present',
  '- Built the billing service.',
  'Software Engineer, Globex Inc   Mar 2018 - Dec 2020',
  '- Built the ledger.',
  '',
  'EDUCATION',
  'University of Texas at Austin',
  'Bachelor of Science in Computer Science, 2014 - 2018',
  '',
  'SKILLS',
  'TypeScript, Python, SQL',
];

async function makePdf(file: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  LINES.forEach((text, index) => text && page.drawText(text, { x: 50, y: 740 - index * 18, size: 11, font }));
  writeFileSync(file, await pdf.save());
}

async function makeDocx(file: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = LINES.filter(Boolean).map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

const test = base.extend<{}, { shared: BrowserContext; extensionId: string; files: { pdf: string; docx: string } }>({
  files: [async ({}, use) => {
    mkdirSync(WORK, { recursive: true });
    const pdf = path.join(WORK, 'jordan-avery.pdf');
    const docx = path.join(WORK, 'jordan-avery.docx');
    await makePdf(pdf);
    await makeDocx(docx);
    await use({ pdf, docx });
  }, { scope: 'worker' }],
  shared: [async ({}, use) => {
    const dist = path.resolve('dist');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await use(context);
    await context.close();
  }, { scope: 'worker' }],
  extensionId: [async ({ shared: context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker.url().split('/')[2]);
  }, { scope: 'worker' }],
});

test.describe.configure({ mode: 'serial' });

async function openPanelFor(context: BrowserContext, extensionId: string, url: string): Promise<{ target: Page; panel: Page }> {
  const target = await context.newPage();
  await target.goto(url);
  const finder = await context.newPage();
  await finder.goto(`chrome-extension://${extensionId}/panel.html`);
  const tabId = await finder.evaluate(async (wanted) => (await chrome.tabs.query({})).find((tab) => tab.url === wanted)?.id, url);
  await finder.close();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`);
  return { target, panel };
}

async function scanAndFill(panel: Page) {
  await panel.click('#scan');
  await expect(panel.locator('#fill')).toBeEnabled();
  await panel.click('#fill');
  await expect(panel.locator('#undo')).toBeEnabled({ timeout: 20000 });
}

async function readLogs(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open('resume-autofill');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('logs').objectStore('logs').getAll();
      all.onsuccess = () => { open.result.close(); resolve(JSON.stringify(all.result)); };
    };
  }));
}

test('parses a PDF resume into the review form and saves it', async ({ shared: context, extensionId, files }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.setInputFiles('#upload', files.pdf);
  await expect(page.locator('#parse-result')).toContainText('Parsed jordan-avery.pdf');
  await expect(page.locator('[data-key=firstName]')).toHaveValue('Jordan');
  await expect(page.locator('[data-key=email]')).toHaveValue(EMAIL);
  await expect(page.locator('[data-key=city]')).toHaveValue('Austin');
  await expect(page.locator('[data-section="Work history"] input').first()).toHaveValue('Acme Corp');
  await expect(page.locator('#gaps')).toContainText('Authorized to work');

  await page.selectOption('[data-key=workAuthorized]', 'yes');
  await page.selectOption('[data-key=sponsorship]', 'no');
  await page.selectOption('[data-key=relocate]', 'yes');
  await page.selectOption('[data-key=gender]', 'decline');
  await page.click('#save');
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.close();
});

test('stores a typed job month the way the fill step reads it', async ({ shared: context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const start = page.locator('[data-section="Work history"] .entry').first().locator('input').nth(3);
  await expect(start).toHaveValue('2021-01');
  await start.fill('2021');
  await start.blur();
  await expect(page.locator('#gaps')).toContainText('Months for your job dates');
  await start.fill('Jun 2021');
  await start.blur();
  await expect(start).toHaveValue('2021-06');
  await expect(page.locator('#gaps')).not.toContainText('Months for your job dates');
  await page.close();
});

test('parses a DOCX resume', async ({ shared: context, extensionId, files }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.setInputFiles('#upload', files.docx);
  await expect(page.locator('#parse-result')).toContainText('Parsed jordan-avery.docx');
  await expect(page.locator('#parse-result')).toContainText('firstName');
  await expect(page.locator('#resumes .list-row')).toHaveCount(2);
  await page.close();
});

test('reparses a stored resume without adding a copy or losing typed answers', async ({ shared: context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const company = page.locator('[data-section="Work history"] input').first();
  await company.fill('Wrong Company');
  await page.click('#save');
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();
  await expect(company).toHaveValue('Wrong Company');

  await page.locator('#resumes .list-row', { hasText: 'jordan-avery.pdf' }).getByRole('button', { name: 'Reparse' }).click();
  await expect(page.locator('#parse-result')).toContainText('Parsed jordan-avery.pdf');
  await expect(company).toHaveValue('Acme Corp');
  await expect(page.locator('[data-key=workAuthorized]')).toHaveValue('yes');
  await expect(page.locator('#resumes .list-row')).toHaveCount(2);

  await page.click('#save');
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();
  await expect(company).toHaveValue('Acme Corp');
  await page.close();
});

test('fills a plain form, attaches the resume and leaves protected fields alone', async ({ shared: context, extensionId, files }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/plain.html`);
  await scanAndFill(panel);

  await expect(target.locator('#fn')).toHaveValue('Jordan');
  await expect(target.locator('#ln')).toHaveValue('Avery');
  await expect(target.locator('#email')).toHaveValue(EMAIL);
  await expect(target.locator('#phone')).toHaveValue('(512) 555-0147');
  await expect(target.locator('#state')).toHaveValue('TX');
  await expect(target.locator('input[name=auth][value="1"]')).toBeChecked();
  await expect(target.locator('#gender')).toHaveValue('Decline To Self Identify');
  await expect(target.locator('#school')).toHaveValue('University of Texas at Austin');
  await expect(target.locator('#grad')).toHaveValue('2018');

  const attached = await target.locator('#resume').evaluate((input: HTMLInputElement) => ({ name: input.files![0]?.name, size: input.files![0]?.size }));
  expect(attached).toEqual({ name: 'jordan-avery.pdf', size: statSync(files.pdf).size });

  await expect(target.locator('#ssn')).toHaveValue('');
  await expect(target.locator('#dob')).toHaveValue('');
  await expect(target.locator('#trap')).toHaveValue('');
  await expect(target.locator('#newsletter')).toHaveValue('');
  await expect(target.locator('#why')).toHaveValue('');
  await expect(target.locator('#consent')).not.toBeChecked();
  expect(await target.evaluate(() => (window as unknown as { submitted?: boolean }).submitted)).toBeUndefined();

  const needs = panel.locator('[data-group="Needs you"]');
  await expect(needs).toContainText('Social Security Number');
  await expect(needs).toContainText('Why do you want to work here?');
  await expect(panel.locator('[data-group="Confirm these answers"]')).toContainText('Gender');

  await panel.click('#undo');
  await expect(target.locator('#fn')).toHaveValue('');
  await expect(target.locator('#state')).toHaveValue('');
  await expect(target.locator('input[name=auth][value="1"]')).not.toBeChecked();
  expect(await target.locator('#resume').evaluate((input: HTMLInputElement) => input.files!.length)).toBe(0);
  await target.close();
  await panel.close();
});

test('fills education dates under a styled section title', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/education.html`);
  await scanAndFill(panel);
  await expect(target.locator('[id="school--0"]')).toHaveValue('University of Texas at Austin');
  await expect(target.locator('[id="degree--0"]')).toHaveValue('Bachelor of Science');
  await expect(target.locator('[id="discipline--0"]')).toHaveValue('Computer Science');
  await expect(target.locator('[id="start-year--0"]')).toHaveValue('2014');
  await expect(target.locator('[id="end-year--0"]')).toHaveValue('2018');
  await target.close();
  await panel.close();
});

test('adds a work block for each job and ticks current role', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/add-another.html`);
  await scanAndFill(panel);
  await expect(target.locator('[id="company-name-1"]')).toHaveValue('Globex Inc');
  await expect(target.locator('[id="company-name-0"]')).toHaveValue('Acme Corp');
  await expect(target.locator('[id="title-1"]')).toHaveValue('Software Engineer');
  await expect(target.locator('[id="start-date-month-0"]')).toHaveValue('January');
  await expect(target.locator('[id="start-date-month-1"]')).toHaveValue('March');
  await expect(target.locator('[id="end-date-year-1"]')).toHaveValue('2020');
  await expect(target.locator('[id="start-date-year-1"]')).toHaveValue('2018');
  await expect(target.locator('[id="end-date-month-1"]')).toHaveValue('December');
  await expect(target.locator('[id="current-role-0_1"]')).toBeChecked();
  await expect(target.locator('[id="current-role-1_1"]')).not.toBeChecked();
  await expect(target.locator('[id="company-name-2"]')).toHaveCount(0);
  await expect(target.locator('#question_1')).toHaveValue('Jordan');
  await expect(target.locator('#question_2')).toHaveValue('Avery');
  await expect(target.locator('#candidate-location')).toHaveValue('Austin, Texas, United States');
  await expect(target.locator('body')).not.toHaveAttribute('data-education', 'added');
  await expect(target.locator('body')).not.toHaveAttribute('data-submitted', 'yes');
  await expect(panel.locator('#status')).toContainText('added 1 work block');
  await target.close();
  await panel.close();
});

test('saves a typed answer and suggests it on the next scan', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/plain.html`);
  await panel.click('#scan');
  await expect(panel.locator('#fill')).toBeEnabled();
  await target.fill('#why', 'I like your mission.');
  await panel.locator('.row', { hasText: 'Why do you want to work here?' }).getByRole('button', { name: 'Save my answer' }).click();
  await expect(panel.locator('.row', { hasText: 'Saved to your answer bank' })).toBeVisible();

  await target.reload();
  await panel.click('#scan');
  const row = panel.locator('.row', { hasText: 'Why do you want to work here?' });
  await expect(row).toContainText('Saved answer');
  await expect(target.locator('#why')).toHaveValue('');
  await row.getByRole('button', { name: 'Use saved answer' }).click();
  await expect(target.locator('#why')).toHaveValue('I like your mission.');
  await target.close();
  await panel.close();
});

test('updates React state through controlled inputs', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/react.html`);
  await scanAndFill(panel);
  await expect.poll(() => target.evaluate(() => (window as unknown as { reactState: unknown }).reactState)).toEqual({ first: 'Jordan', email: EMAIL, state: 'TX', file: 'jordan-avery.pdf' });
  await target.close();
  await panel.close();
});

test('handles custom dropdowns, shadow DOM, role radios, editors and drop zones', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/custom.html`);
  await scanAndFill(panel);

  await expect(target.locator('#nearby')).toHaveValue('Jordan');
  await expect(target.locator('#combo')).toHaveValue('No');
  await expect(target.locator('#btn-select')).toHaveText('Yes, I am authorized');
  await expect(target.locator('#typeahead')).toHaveValue('Austin');
  await expect(target.locator('#r-yes')).toHaveAttribute('aria-checked', 'true');
  await expect(target.locator('x-open-input input')).toHaveValue('Avery');
  expect(await target.evaluate(() => (window as unknown as { closedRoot: ShadowRoot }).closedRoot.querySelector('input')!.value)).toBe(EMAIL);
  await expect(target.locator('#bio')).toHaveText('Backend engineer focused on payments.');
  expect(await target.evaluate(() => (window as unknown as { dropped?: string }).dropped)).toBe('jordan-avery.pdf');

  await panel.click('#undo');
  await expect(target.locator('#combo')).toHaveValue('');
  await expect(target.locator('#typeahead')).toHaveValue('');
  await expect(target.locator('#nearby')).toHaveValue('');
  // The button list started on a placeholder that is not an option, and a dropped file can't be taken back.
  await expect(panel.locator('body')).toContainText("2 custom control(s) can't be undone automatically");
  await target.close();
  await panel.close();
});

test('uploads first, then fills the rebuilt form without overwriting what the site parsed', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/parses-upload.html`);
  await scanAndFill(panel);
  await expect(target.locator('#email')).toHaveAttribute('data-version', 'new');
  await expect(target.locator('#email')).toHaveValue(EMAIL);
  await expect(target.locator('#first')).toHaveValue('SiteParsedName');

  const row = panel.locator('.row', { hasText: 'First name' });
  await expect(row).toContainText('Has value');
  await row.getByRole('button', { name: 'Replace with mine' }).click();
  await expect(target.locator('#first')).toHaveValue('Jordan');
  await target.close();
  await panel.close();
});

test('fills again when a late resume parse wipes the form, except fields the user edited', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/late-parse.html`);
  await scanAndFill(panel);
  await expect(target.locator('#email')).toHaveValue(EMAIL);

  await target.locator('#city').click();
  await target.keyboard.press('Control+A');
  await target.keyboard.press('Delete');
  await target.waitForFunction(() => document.body.dataset.parsed === 'yes', undefined, { timeout: 8000 });

  await expect(target.locator('#email')).toHaveValue(EMAIL, { timeout: 12000 });
  await expect(target.locator('#phone')).not.toHaveValue('', { timeout: 12000 });
  await expect(target.locator('#zip')).toHaveValue('78701');
  await expect(target.locator('#city')).toHaveValue('');
  await expect(panel.locator('#status')).toContainText('filled again');
  await target.close();
  await panel.close();
});

test('reaches cross-origin and srcdoc iframes', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/frames.html`);
  await scanAndFill(panel);
  await expect(target.frameLocator('#cross').locator('#fn')).toHaveValue('Jordan');
  await expect(target.frameLocator('#inline').locator('#c')).toHaveValue('Austin');
  await target.close();
  await panel.close();
});

test('logs structure but no personal values unless debug is on', async ({ shared: context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect.poll(async () => (await readLogs(options)).includes('fill.done')).toBe(true);
  const logs = await readLogs(options);
  expect(logs).toContain('field.unmatched');
  expect(logs).toContain('question_90210');
  expect(logs).toContain('domPath');
  expect(logs).not.toContain(EMAIL);
  expect(logs).not.toContain('555-0147');
  expect(logs).not.toContain('I like your mission');

  await options.check('#debug');
  await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('debugUntil')).debugUntil)).toBeGreaterThan(Date.now());
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/plain.html`);
  await panel.click('#scan');
  await expect(panel.locator('#fill')).toBeEnabled();
  await expect.poll(async () => (await readLogs(options)).includes(EMAIL)).toBe(true);
  await options.uncheck('#debug');
  await target.close();
  await panel.close();
  await options.close();
});

test('fills a street address search box and picks the suggestion in the right town', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/address-search.html`);
  await scanAndFill(panel);
  await expect(target.locator('#street')).toHaveValue('123 Maple St, Austin TX 78701', { timeout: 10000 });
  await expect(target.locator('#picked-city')).toHaveText('Austin');
  await target.close();
  await panel.close();
});

test('keeps a connection choice made as the options page opens', async ({ shared: context, extensionId }) => {
  const options = await context.newPage();
  // The saved settings normally load in a few milliseconds. Holding the database open makes the wait long enough to hit.
  await options.addInitScript(() => {
    const listen = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, extra?: boolean | AddEventListenerOptions) {
      if (this instanceof IDBOpenDBRequest && type === 'success' && typeof listener === 'function') {
        const run = listener;
        return listen.call(this, type, (event: Event) => { setTimeout(() => run.call(this, event), 700); }, extra);
      }
      return listen.call(this, type, listener, extra);
    };
  });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.selectOption('#claude-mode', 'bridge');
  await expect(options.locator('#claude-bridge-fields')).toBeVisible({ timeout: 3000 });
  await options.waitForTimeout(1000);
  await expect(options.locator('#claude-mode')).toHaveValue('bridge');
  await expect(options.locator('#claude-bridge-fields')).toBeVisible();
  await options.close();
});

test('reviews missed fields with Claude, applies answers, and saves only what the user approves', async ({ shared: context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.selectOption('#claude-mode', 'api');
  await options.fill('#claude-key', 'fake-key-for-mocked-test');
  await options.click('#claude-save');
  await expect(options.locator('#claude-status')).toHaveText('Saved.');

  let sent = '';
  let headers: Record<string, string> = {};
  await context.route('https://api.anthropic.com/**', async (route) => {
    sent = route.request().postData() ?? '';
    headers = route.request().headers();
    const prompt = JSON.parse(sent).messages[0].content as string;
    const questions = JSON.parse(prompt.slice(prompt.indexOf('<questions>') + 11, prompt.indexOf('</questions>'))) as { id: string; label: string }[];
    const idFor = (label: string) => questions.find((question) => question.label.includes(label))!.id;
    await route.fulfill({ json: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ answers: [
        { id: idFor('platform work'), answer: 'Building reliable systems', confidence: 'medium', basis: 'From the work history.' },
        { id: idFor('shift'), answer: 'Days', confidence: 'low', basis: 'Loose fit.' },
        { id: idFor('mascot'), answer: null, confidence: 'low', basis: 'Not in the profile.' },
      ] }) }],
    } });
  });

  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/review.html`);
  await panel.click('#scan');
  await expect(panel.locator('#review')).toBeEnabled();
  await panel.click('#review');

  const platform = panel.locator('[data-review*="platform work"]');
  await expect(platform).toBeVisible({ timeout: 15000 });
  await expect(target.locator('#q1')).toHaveValue('Building reliable systems');
  await expect(target.locator('#q2')).toHaveValue('Days');
  await expect(target.locator('#q3')).toHaveValue('');

  const body = JSON.parse(sent);
  expect(sent).toContain(EMAIL);
  expect(sent).not.toContain('Social Security');
  expect(sent).not.toContain('I certify');
  expect(sent).not.toContain('Select one');
  expect(body.fallbacks).toBe('default');
  expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
  expect(body.output_config.format.type).toBe('json_schema');

  await platform.getByRole('textbox').fill('Keeping systems up');
  await platform.getByRole('button', { name: 'Save answer' }).click();
  await expect(target.locator('#q1')).toHaveValue('Keeping systems up');
  await expect(platform).toHaveCount(0);

  const shift = panel.locator('[data-review*="shift"]');
  await shift.getByRole('combobox').selectOption('Nights');
  await shift.getByRole('button', { name: 'Use without saving' }).click();
  await expect(target.locator('#q2')).toHaveValue('Nights');
  await expect(shift).toHaveCount(0);

  await options.reload();
  const answers = options.locator('#answers');
  await expect(answers).toContainText('platform work');
  await expect(answers).not.toContainText('shift pattern');
  const logs = await readLogs(options);
  expect(logs).toContain('claude.review.done');
  expect(logs).not.toContain('fake-key-for-mocked-test');
  expect(logs).not.toContain('Keeping systems up');

  await panel.click('#undo');
  await expect(target.locator('#q1')).toHaveValue('');
  await context.unroute('https://api.anthropic.com/**');
  await target.close();
  await panel.close();
  await options.close();
});

test('sends Claude only the fields the site left empty', async ({ shared: context, extensionId }) => {
  const sent: string[] = [];
  await context.route('https://api.anthropic.com/**', async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}').messages[0].content as string);
    await route.fulfill({ json: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify({ answers: [] }) }],
    } });
  });

  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/site-filled.html`);
  await panel.click('#scan');
  await expect(panel.locator('#review')).toBeEnabled();
  await target.fill('#late', 'Filled by the site after the scan');
  await panel.click('#review');
  await expect(panel.locator('#status')).toContainText('Claude found no answers', { timeout: 15000 });

  expect(sent).toHaveLength(1);
  const questions = sent[0].slice(sent[0].indexOf('<questions>'));
  expect(questions).toContain('Preferred office wing');
  expect(questions).toContain('Favorite conference');
  expect(questions).not.toContain('Favorite sales region');
  expect(questions).not.toContain('Nickname at work');
  await context.unroute('https://api.anthropic.com/**');
  await target.close();
  await panel.close();
});

test('offers a Claude draft on open questions and applies it for approval', async ({ shared: context, extensionId }) => {
  const sent: string[] = [];
  await context.route('https://api.anthropic.com/**', async (route) => {
    const body = route.request().postData() ?? '';
    sent.push(body);
    const prompt = JSON.parse(body).messages[0].content as string;
    const [question] = JSON.parse(prompt.slice(prompt.indexOf('<questions>') + 11, prompt.indexOf('</questions>'))) as { id: string; label: string }[];
    const answer = question.label.includes('join') ? 'I build systems that stay up.' : null;
    await route.fulfill({ json: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: question.id, answer, confidence: 'medium', basis: 'Work history.' }] }) }],
    } });
  });

  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/questions.html`);
  await panel.click('#scan');
  const needsYou = panel.locator('[data-group="Needs you"]');
  const button = { name: 'Draft reply with Claude' };
  await expect(needsYou.locator('.row', { hasText: 'Why do you want to join' }).getByRole('button', button)).toBeVisible();
  await expect(needsYou.locator('.row', { hasText: 'Favorite sales region' }).getByRole('button', button)).toHaveCount(0);
  await expect(panel.getByRole('button', button)).toHaveCount(2);

  await needsYou.locator('.row', { hasText: 'Why do you want to join' }).getByRole('button', button).click();
  const draft = panel.locator('[data-review*="join our team"]');
  await expect(draft).toBeVisible({ timeout: 15000 });
  await expect(target.locator('#join')).toHaveValue('I build systems that stay up.');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('draft replies');
  expect(sent[0]).toContain('Platform engineer at Acme Tools');
  expect(sent[0]).not.toContain('What motivates you');

  await draft.getByRole('button', { name: 'Use without saving' }).click();
  await expect(draft).toHaveCount(0);

  const motive = needsYou.locator('.row', { hasText: 'What motivates you' });
  await motive.getByRole('button', button).click();
  await expect(motive).toContainText('could not draft', { timeout: 15000 });
  await expect(motive.getByRole('button', button)).toHaveCount(0);
  await expect(target.locator('#motive')).toHaveValue('');
  expect(sent).toHaveLength(2);

  await context.unroute('https://api.anthropic.com/**');
  await target.close();
  await panel.close();
});

const checkedChoice = (target: Page) => target.evaluate(() => Array.from(document.querySelectorAll('[role=radio]')).map((el) => el.getAttribute('aria-checked')).join());

test('keeps a value typed after the scan, reports a cut value, and undoes groups exactly', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/regress.html`);
  await panel.click('#scan');
  await expect(panel.locator('#fill')).toBeEnabled();
  await target.fill('#fn', 'Alex');
  await panel.click('#fill');
  await expect(panel.locator('#undo')).toBeEnabled({ timeout: 20000 });

  await expect(target.locator('#fn')).toHaveValue('Alex');
  await expect(panel.locator('#report')).toContainText('left alone');
  await expect(panel.locator('#report')).toContainText('page changed the value');
  await expect(target.locator('input[name=move][value=y]')).toBeChecked();
  expect(await checkedChoice(target)).toBe('true,false');

  await panel.click('#undo');
  await expect(panel.locator('#undo')).toBeDisabled();
  await expect(target.locator('input[name=move][value=y]')).not.toBeChecked();
  expect(await checkedChoice(target)).toBe('false,false');
  await expect(panel.locator('#status')).not.toContainText('undone');
  await target.close();
  await panel.close();
});

test('leaves a radio group alone after the user answers it', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/regress.html`);
  await scanAndFill(panel);
  await target.click('input[name=move][value=n]');
  await target.evaluate(() => document.querySelectorAll<HTMLInputElement>('input[name=move]').forEach((el) => { el.checked = false; }));
  await panel.waitForTimeout(3000);
  await expect(target.locator('input[name=move][value=y]')).not.toBeChecked();
  await target.close();
  await panel.close();
});

test('undo puts a checkbox group back after Replace with mine', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/regress.html`);
  await panel.click('#scan');
  await panel.locator('.row', { hasText: 'Will you require visa sponsorship' }).getByRole('button', { name: 'Replace with mine' }).click();
  await expect(target.locator('input[name=spon][value=n]')).toBeChecked();
  await expect(target.locator('input[name=spon][value=y]')).not.toBeChecked();
  await panel.click('#undo');
  await expect(target.locator('input[name=spon][value=y]')).toBeChecked();
  await expect(target.locator('input[name=spon][value=n]')).not.toBeChecked();
  await target.close();
  await panel.close();
});

test('applies every saved choice to a checkbox group and undoes them together', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/multi.html`);
  const box = (id: string) => target.locator(`#${id}`);
  const row = panel.locator('.row', { hasText: 'Which office days suit you best' });
  await panel.click('#scan');
  await box('mon').check();
  await box('fri').check();
  await row.getByRole('button', { name: 'Save my answer' }).click();
  await expect(panel.locator('.row', { hasText: 'Saved to your answer bank' })).toBeVisible();

  await target.reload();
  await panel.click('#scan');
  await expect(row).toContainText('Saved answer');
  await box('wed').check();
  await row.getByRole('button', { name: 'Use saved answer' }).click();
  await expect(box('mon')).toBeChecked();
  await expect(box('fri')).toBeChecked();
  await expect(box('wed')).not.toBeChecked();
  await expect(box('tue')).not.toBeChecked();

  await panel.click('#undo');
  await expect(box('wed')).toBeChecked();
  await expect(box('mon')).not.toBeChecked();
  await expect(box('fri')).not.toBeChecked();
  await target.close();
  await panel.close();
});

test('applies every saved choice to a multi-select list and undoes them together', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/multi.html`);
  const list = target.locator('#areas');
  const chosen = () => list.evaluate((el: HTMLSelectElement) => Array.from(el.selectedOptions, (option) => option.value));
  const row = panel.locator('.row', { hasText: 'Which sales territories would you cover' });
  await panel.click('#scan');
  await list.selectOption(['North', 'West']);
  await row.getByRole('button', { name: 'Save my answer' }).click();
  await expect(panel.locator('.row', { hasText: 'Saved to your answer bank' })).toBeVisible();

  await target.reload();
  await panel.click('#scan');
  await expect(row).toContainText('Saved answer');
  await list.selectOption(['East']);
  await row.getByRole('button', { name: 'Use saved answer' }).click();
  await expect.poll(chosen).toEqual(['North', 'West']);
  await panel.click('#undo');
  await expect.poll(chosen).toEqual(['East']);
  await target.close();
  await panel.close();
});

test('picks every saved choice in a custom list that closes after each pick', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/multi.html`);
  const chips = target.locator('#team-chips .chip');
  const pick = async (name: string) => {
    await target.click('#team');
    await target.getByRole('option', { name }).click();
  };
  const row = panel.locator('.row', { hasText: 'Which teams interest you' });
  await panel.click('#scan');
  await pick('Platform');
  await pick('Security');
  await row.getByRole('button', { name: 'Save my answer' }).click();
  await expect(panel.locator('.row', { hasText: 'Saved to your answer bank' })).toBeVisible();

  await target.reload();
  await panel.click('#scan');
  await expect(row).toContainText('Saved answer');
  await pick('Data');
  await row.getByRole('button', { name: 'Use saved answer' }).click();
  await expect(chips).toHaveText(['Platform', 'Security'], { timeout: 10000 });
  await panel.click('#fill');
  await expect(target.locator('#fn')).not.toHaveValue('');
  // The watch that restores wiped fields must not toggle these back off.
  await panel.waitForTimeout(2000);
  await expect(chips).toHaveText(['Platform', 'Security']);

  await target.evaluate(() => {
    document.querySelectorAll('#team-list [role=option]').forEach((option) => option.setAttribute('aria-selected', 'false'));
    document.getElementById('team-chips')!.replaceChildren();
  });
  await expect(chips).toHaveText(['Platform', 'Security'], { timeout: 10000 });

  await panel.click('#undo');
  await expect(chips).toHaveText(['Data'], { timeout: 10000 });
  await expect(target.locator('#team-list [aria-selected=true]')).toHaveText(['Data']);
  await target.close();
  await panel.close();
});

test('replaces chips in a custom list that hides picked items from its menu', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/multi.html`);
  const chips = target.locator('#tool-chips .chip');
  const pick = async (name: string) => {
    await target.click('#tool');
    await target.getByRole('option', { name }).click();
  };
  const row = panel.locator('.row', { hasText: 'Which design tools have you used' });
  await panel.click('#scan');
  await pick('Figma');
  await pick('Sketch');
  await row.getByRole('button', { name: 'Save my answer' }).click();
  await expect(panel.locator('.row', { hasText: 'Saved to your answer bank' })).toBeVisible();

  await target.reload();
  await panel.click('#scan');
  await expect(row).toContainText('Saved answer');
  await pick('Figma');
  await pick('Canva');
  await row.getByRole('button', { name: 'Use saved answer' }).click();
  await expect(chips).toHaveText(['Figma×', 'Sketch×'], { timeout: 10000 });

  await panel.click('#undo');
  await expect(chips).toHaveText(['Figma×', 'Canva×'], { timeout: 10000 });
  await target.close();
  await panel.close();
});

test('leaves a wiped field empty when Undo comes before the restore', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/regress.html`);
  await scanAndFill(panel);
  // Constant page changes keep the restore waiting for the page to settle.
  await target.evaluate(() => {
    (window as unknown as { busy: number }).busy = window.setInterval(() => document.body.toggleAttribute('data-busy'), 100);
    (document.querySelector('#fn') as HTMLInputElement).value = '';
  });
  await panel.waitForTimeout(2000);
  await panel.click('#undo');
  await expect(panel.locator('#undo')).toBeDisabled();
  await target.evaluate(() => window.clearInterval((window as unknown as { busy: number }).busy));
  await panel.waitForTimeout(7000);
  await expect(target.locator('#fn')).toHaveValue('');
  await target.close();
  await panel.close();
});

const UPLOAD_PAGE = '<!doctype html><title>t</title><form><label for="fn">First name</label><input id="fn" name="first_name"><label for="q1">Which team project are you proudest of</label><input id="q1" name="question_11"><label for="resume">Resume</label><input id="resume" type="file" name="resume"></form>';
const fileCount = (target: Page) => target.locator('#resume').evaluate((input: HTMLInputElement) => input.files!.length);

test('attaches the resume again after Undo and offers no Replace on a file field', async ({ shared: context, extensionId }) => {
  await context.route('http://fixture.test/**', (route) => route.fulfill({ contentType: 'text/html', body: UPLOAD_PAGE }));
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/upload.html');
  await scanAndFill(panel);
  expect(await fileCount(target)).toBe(1);
  await panel.click('#undo');
  await expect(panel.locator('#fill')).toBeEnabled();
  expect(await fileCount(target)).toBe(0);
  await panel.click('#fill');
  await expect.poll(() => fileCount(target), { timeout: 20000 }).toBe(1);
  await expect(panel.locator('#scan')).toBeEnabled({ timeout: 20000 });
  await panel.click('#scan');
  const resumeRow = panel.locator('.row', { hasText: 'Resume' }).first();
  await expect(resumeRow).toContainText('Has value');
  await expect(resumeRow.getByRole('button', { name: 'Replace with mine' })).toHaveCount(0);
  await target.close();
  await panel.close();
});

test('holds Scan during a Claude review and keeps its answers through an upload', async ({ shared: context, extensionId }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route('https://api.anthropic.com/**', async (route) => {
    const prompt = JSON.parse(route.request().postData() ?? '{}').messages[0].content as string;
    const questions = JSON.parse(prompt.slice(prompt.indexOf('<questions>') + 11, prompt.indexOf('</questions>'))) as { id: string }[];
    await held;
    await route.fulfill({ json: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ answers: questions.map((question) => ({ id: question.id, answer: 'Building reliable systems', confidence: 'medium', basis: 'Work history.' })) }) }],
    } });
  });
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/review-upload.html');
  await panel.click('#scan');
  await expect(panel.locator('#review')).toBeEnabled();
  await panel.click('#review');
  await expect(panel.locator('#scan')).toBeDisabled();
  await panel.locator('.row', { hasText: 'First name' }).getByRole('button', { name: 'Show' }).click();
  await panel.waitForTimeout(500);
  await expect(panel.locator('#scan')).toBeDisabled();
  release();

  const question = panel.locator('[data-review*="team project"]');
  await expect(question).toBeVisible({ timeout: 15000 });
  await panel.click('#fill');
  await expect.poll(() => fileCount(target), { timeout: 20000 }).toBe(1);
  await expect(panel.locator('#scan')).toBeEnabled({ timeout: 20000 });
  await expect(question).toBeVisible();
  await expect(target.locator('#q1')).toHaveValue('Building reliable systems');
  await target.close();
  await panel.close();
});

test('saves every edit when Save is clicked twice, and an open panel sees a new resume', async ({ shared: context, extensionId, files }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/regress.html`);
  await expect(panel.locator('#resume option').first()).toBeAttached();
  const before = await panel.locator('#resume option').count();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const company = options.locator('[data-section="Work history"] input').first();
  await expect(company).toHaveValue('Acme Corp');
  await options.click('#save');
  await expect(options.locator('#save-status')).toHaveText('Saved');
  await company.fill('Globex');
  await options.click('#save');
  await expect(options.locator('#save-status')).toHaveText('Saved');
  await options.reload();
  await expect(company).toHaveValue('Globex');
  await company.fill('Acme Corp');
  await options.click('#save');
  await expect(options.locator('#save-status')).toHaveText('Saved');

  await options.setInputFiles('#upload', files.docx);
  await expect(options.locator('#parse-result')).toContainText('Parsed jordan-avery.docx');
  await options.close();
  await panel.click('#scan');
  await expect(panel.locator('#resume option')).toHaveCount(before + 1);
  await target.close();
  await panel.close();
});

test('fills a menu button dropdown backed by a hidden select', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/menu-select.html`);
  await panel.click('#scan');
  await expect(panel.locator('#report')).toContainText('2 fields found');
  await expect(panel.locator('[data-group="Left alone"]')).toContainText('Country');
  await panel.click('#fill');
  await expect(target.locator('#state')).toHaveText('Texas', { timeout: 10000 });
  await expect(target.locator('#country')).toHaveText('United States');
  await expect(panel.locator('[data-group="Filled"]')).toContainText('State');
  await target.close();
  await panel.close();
});

test('takes several answers from Claude for a multi-select question', async ({ shared: context, extensionId }) => {
  const page = '<!doctype html><title>t</title><form><label for="areas">Which product areas interest you most</label><select id="areas" multiple><option>Payments</option><option>Search</option><option>Mobile</option></select></form>';
  const pageRoute = (route: Route) => route.fulfill({ contentType: 'text/html', body: page });
  let multiple = false;
  const claudeRoute = async (route: Route) => {
    const prompt = JSON.parse(route.request().postData() ?? '{}').messages[0].content as string;
    const questions = JSON.parse(prompt.slice(prompt.indexOf('<questions>') + 11, prompt.indexOf('</questions>'))) as { id: string; label: string; multiple: boolean }[];
    const question = questions.find((item) => item.label.includes('product areas'))!;
    multiple = question.multiple;
    await route.fulfill({ json: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: question.id, answer: 'Payments, Search', confidence: 'medium', basis: 'Work history.' }] }) }],
    } });
  };
  await context.route('http://fixture.test/multi-review.html', pageRoute);
  await context.route('https://api.anthropic.com/**', claudeRoute);
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/multi-review.html');
  const chosen = () => target.locator('#areas').evaluate((el: HTMLSelectElement) => Array.from(el.selectedOptions, (option) => option.value));
  await panel.click('#scan');
  await expect(panel.locator('#review')).toBeEnabled();
  await panel.click('#review');
  const row = panel.locator('[data-review*="product areas"]');
  await expect(row).toBeVisible({ timeout: 15000 });
  expect(multiple).toBe(true);
  await expect.poll(chosen).toEqual(['Payments', 'Search']);

  await row.locator('select').selectOption(['Payments', 'Mobile']);
  await row.getByRole('button', { name: 'Use without saving' }).click();
  await expect.poll(chosen).toEqual(['Payments', 'Mobile']);
  await context.unroute('https://api.anthropic.com/**', claudeRoute);
  await context.unroute('http://fixture.test/multi-review.html', pageRoute);
  await target.close();
  await panel.close();
});

test('attaches the resume again after the user removes it from the page', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/remove.html');
  await scanAndFill(panel);
  expect(await fileCount(target)).toBe(1);
  await target.locator('#resume').evaluate((input: HTMLInputElement) => { input.value = ''; });
  await panel.click('#scan');
  await expect(panel.locator('#fill')).toBeEnabled();
  await panel.click('#fill');
  await expect.poll(() => fileCount(target), { timeout: 20000 }).toBe(1);
  await target.close();
  await panel.close();
});

test('tells two resumes with the same file name apart when a form rebuilds its input', async ({ shared: context, extensionId }) => {
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/same-name.html');
  await expect(panel.locator('#resume option').first()).toBeAttached();
  const twins = await panel.locator('#resume option').evaluateAll((options: HTMLOptionElement[]) => options.filter((option) => option.text.includes('jordan-avery.docx')).map((option) => option.value));
  expect(twins.length).toBeGreaterThan(1);
  // A cloned file input keeps its files in Chrome, so the rebuilt one starts from nothing.
  const rebuildInput = () => target.locator('#resume').evaluate((input: HTMLInputElement) => {
    const fresh = document.createElement('input');
    Object.assign(fresh, { type: 'file', id: 'resume', name: 'resume' });
    input.replaceWith(fresh);
  });

  await panel.selectOption('#resume', twins[0]);
  await scanAndFill(panel);
  expect(await fileCount(target)).toBe(1);
  await rebuildInput();
  await panel.click('#scan');
  await expect(panel.locator('#fill')).toBeEnabled();
  await panel.click('#fill');
  await expect(panel.locator('#scan')).toBeEnabled({ timeout: 20000 });
  expect(await fileCount(target)).toBe(0);

  await panel.click('#scan');
  await panel.selectOption('#resume', twins[1]);
  await expect(panel.locator('#fill')).toBeEnabled();
  await panel.click('#fill');
  await expect.poll(() => fileCount(target), { timeout: 20000 }).toBe(1);
  await target.close();
  await panel.close();
});

test('attaches again when the page showed the file, rebuilt its input, and the user removed it', async ({ shared: context, extensionId }) => {
  const script = `<script>document.querySelector('form').addEventListener('change', (event) => {
    if (event.target.id !== 'resume') return;
    document.getElementById('shown').textContent = event.target.files[0].name;
    const fresh = document.createElement('input');
    fresh.type = 'file'; fresh.id = 'resume'; fresh.name = 'resume';
    event.target.replaceWith(fresh);
  });</script>`;
  const body = UPLOAD_PAGE.replace('</form>', `<span id="shown"></span></form>${script}`);
  const pageRoute = (route: Route) => route.fulfill({ contentType: 'text/html', body });
  await context.route('http://fixture.test/rebuild.html', pageRoute);
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/rebuild.html');
  const shown = target.locator('#shown');
  await scanAndFill(panel);
  await expect(shown).not.toHaveText('');
  await target.evaluate(() => { document.getElementById('shown')!.textContent = ''; });
  await panel.click('#scan');
  await expect(panel.locator('#fill')).toBeEnabled();
  await panel.click('#fill');
  await expect(shown).not.toHaveText('', { timeout: 20000 });
  await context.unroute('http://fixture.test/rebuild.html', pageRoute);
  await target.close();
  await panel.close();
});

test('sees what a form already picked in lists with placeholders, hidden inputs and wrapped inputs', async ({ shared: context, extensionId }) => {
  const body = '<!doctype html><title>t</title><form>'
    + '<label for="a">Preferred territories</label><select id="a" multiple><option value="" selected>Select...</option><option selected>North</option><option>South</option></select>'
    + '<div class="is-multi"><span class="chip">Platform</span><input type="hidden" name="t" value="1"><input id="t" role="combobox" aria-label="Preferred teams"></div>'
    + '<div id="s" role="combobox" aria-label="Preferred shift" tabindex="0"><input value="Days"></div>'
    + '</form>';
  const pageRoute = (route: Route) => route.fulfill({ contentType: 'text/html', body });
  await context.route('http://fixture.test/picked.html', pageRoute);
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/picked.html');
  await panel.click('#scan');
  const row = (name: string) => panel.locator('.row', { hasText: name });
  await expect(row('Preferred territories')).toContainText('already has a value');
  await expect(row('Preferred teams')).toContainText('already has a value');
  await row('Preferred shift').getByRole('button', { name: 'Save my answer' }).click();
  await expect(row('Preferred shift')).toContainText('Saved to your answer bank');
  await context.unroute('http://fixture.test/picked.html', pageRoute);
  await target.close();
  await panel.close();
});

test('keeps an exact saved choice when a form offers only part of the saved list', async ({ shared: context, extensionId }) => {
  const page = (options: string[]) => `<!doctype html><title>t</title><form><label for="f">Which focus areas suit you</label><select id="f" multiple>${options.map((option) => `<option>${option}</option>`).join('')}</select></form>`;
  const pageRoute = (route: Route) => route.fulfill({ contentType: 'text/html', body: page(route.request().url().endsWith('full.html') ? ['Platform', 'Analytics', 'Data, Analytics'] : ['Analytics', 'Data, Analytics']) });
  await context.route('http://fixture.test/focus-*.html', pageRoute);
  const { target, panel } = await openPanelFor(context, extensionId, 'http://fixture.test/focus-full.html');
  const list = target.locator('#f');
  const row = panel.locator('.row', { hasText: 'Which focus areas suit you' });
  await panel.click('#scan');
  await list.selectOption(['Platform', 'Data, Analytics']);
  await row.getByRole('button', { name: 'Save my answer' }).click();
  await expect(row).toContainText('Saved to your answer bank');

  await target.goto('http://fixture.test/focus-part.html');
  await panel.click('#scan');
  await expect(row).toContainText('Saved answer');
  await row.getByRole('button', { name: 'Use saved answer' }).click();
  await expect.poll(() => list.evaluate((el: HTMLSelectElement) => Array.from(el.selectedOptions, (option) => option.value))).toEqual(['Data, Analytics']);
  await context.unroute('http://fixture.test/focus-*.html', pageRoute);
  await target.close();
  await panel.close();
});

test('leaves no PDF parsing workers behind after repeated parses',async ({ shared: context, extensionId, files }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.setInputFiles('#upload', files.pdf);
  await expect(page.locator('#parse-result')).toContainText('Parsed jordan-avery.pdf');
  const reparse = page.locator('#resumes .list-row', { hasText: 'jordan-avery.pdf' }).getByRole('button', { name: 'Reparse' }).first();
  for (let parse = 0; parse < 3; parse++) {
    await reparse.click();
    await page.waitForTimeout(1500);
  }
  await expect.poll(() => page.workers().length).toBe(0);
  await page.close();
});

test('reviews missed fields with a local model through the OpenAI chat format', async ({ shared: context, extensionId }) => {
  const posts: { body: any; headers: Record<string, string> }[] = [];
  let listed = 0;
  await context.route('http://localhost:11434/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      listed++;
      await route.fulfill({ json: { object: 'list', data: [{ id: 'fake-local-model' }, { id: 'another-model' }] } });
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}');
    posts.push({ body, headers: request.headers() });
    const prompt = body.messages[1].content as string;
    const questions = JSON.parse(prompt.slice(prompt.indexOf('<questions>') + 11, prompt.indexOf('</questions>'))) as { id: string; label: string }[];
    const shift = questions.find((question) => question.label.includes('shift'))!;
    const answers = { answers: [{ id: shift.id, answer: 'Nights', confidence: 'medium', basis: 'From the work history.' }] };
    await route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `<think>Checking the profile.</think>${JSON.stringify(answers)}` } }] } });
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.selectOption('#claude-mode', 'openai');
  await expect(options.locator('#ai-other-fields')).toBeVisible();
  await expect(options.locator('#claude-api-fields')).toBeHidden();
  await options.selectOption('#ai-provider', 'openai');
  await expect(options.locator('#ai-key-row')).toBeVisible();
  await expect(options.locator('#ai-base')).toHaveValue('https://api.openai.com/v1');
  await options.selectOption('#ai-provider', 'ollama');
  await expect(options.locator('#ai-key-row')).toBeHidden();
  await expect(options.locator('#ai-local-note')).toBeVisible();
  await expect(options.locator('#ai-base')).toHaveValue('http://localhost:11434/v1');

  await options.click('#claude-test');
  await expect(options.locator('#claude-status')).toContainText('Reached Ollama and found 2 model(s)');
  await expect(options.locator('#ai-models option')).toHaveCount(2);
  await options.fill('#ai-model', 'fake-local-model');
  await options.click('#claude-save');
  await expect(options.locator('#claude-status')).toHaveText('Saved.');
  await options.click('#claude-test');
  await expect(options.locator('#claude-status')).toHaveText('Ollama is working and has fake-local-model.');
  expect(listed).toBe(2);
  expect(posts).toHaveLength(0);

  await options.reload();
  await expect(options.locator('#claude-mode')).toHaveValue('openai');
  await expect(options.locator('#ai-provider')).toHaveValue('ollama');
  await expect(options.locator('#ai-model')).toHaveValue('fake-local-model');

  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/review.html`);
  await expect(panel.locator('#review')).toHaveText('Review missed with Ollama');
  await panel.click('#scan');
  await expect(panel.locator('#review')).toBeEnabled();
  await panel.click('#review');
  await expect(panel.locator('#status')).toContainText('Ollama answered 1 of', { timeout: 15000 });
  await expect(target.locator('#q2')).toHaveValue('Nights');
  await expect(panel.locator('[data-group="Claude"]')).toContainText("Ollama's answers");

  expect(posts).toHaveLength(1);
  const { body, headers } = posts[0];
  expect(body.model).toBe('fake-local-model');
  expect(body.response_format.type).toBe('json_schema');
  expect(body.messages[0].role).toBe('system');
  expect(body.messages[0].content).toContain('JSON schema');
  expect(body.messages[1].content).toContain(EMAIL);
  expect(body.messages[1].content).not.toContain('Social Security');
  expect(headers.authorization).toBeUndefined();
  expect(headers['x-api-key']).toBeUndefined();

  const logs = await readLogs(options);
  expect(logs).toContain('"provider":"Ollama"');
  expect(logs).toContain('fake-local-model');

  await panel.click('#undo');
  await expect(target.locator('#q2')).toHaveValue('');
  await context.unroute('http://localhost:11434/**');
  await target.close();
  await panel.close();
  await options.close();
});

test('offers OpenAI by API key and Codex on this PC beside the Claude connections', async ({ shared: context, extensionId }) => {
  const posts: { body: any; headers: Record<string, string> }[] = [];
  await context.route('https://api.openai.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { object: 'list', data: [{ id: 'fake-openai-model' }] } });
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}');
    posts.push({ body, headers: request.headers() });
    const prompt = body.messages[1].content as string;
    const questions = JSON.parse(prompt.slice(prompt.indexOf('<questions>') + 11, prompt.indexOf('</questions>'))) as { id: string; label: string }[];
    const shift = questions.find((question) => question.label.includes('shift'))!;
    const answers = { answers: [{ id: shift.id, answer: 'Days', confidence: 'high', basis: 'From the work history.' }] };
    await route.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answers) } }] } });
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.selectOption('#claude-mode', 'codex');
  await expect(options.locator('#codex-bridge-fields')).toBeVisible();
  await expect(options.locator('#ai-other-fields')).toBeHidden();
  await expect(options.locator('#claude-model-row')).toBeHidden();
  await options.fill('#codex-model', 'fake-codex-model');

  await options.selectOption('#claude-mode', 'codex-api');
  await expect(options.locator('#codex-bridge-fields')).toBeHidden();
  await expect(options.locator('#ai-key-row')).toBeVisible();
  await expect(options.locator('#ai-provider-row')).toBeHidden();
  await expect(options.locator('#ai-local-note')).toBeHidden();
  await options.fill('#ai-key', 'fake-openai-key-for-mocked-test');
  await options.fill('#ai-model', 'fake-openai-model');
  await options.click('#claude-test');
  await expect(options.locator('#claude-status')).toHaveText('OpenAI is working and has fake-openai-model.');

  await options.reload();
  await expect(options.locator('#claude-mode')).toHaveValue('codex-api');
  await expect(options.locator('#ai-model')).toHaveValue('fake-openai-model');
  await expect(options.locator('#codex-model')).toHaveValue('fake-codex-model');

  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/review.html`);
  await expect(panel.locator('#review')).toHaveText('Review missed with OpenAI');
  await panel.click('#scan');
  await expect(panel.locator('#review')).toBeEnabled();
  await panel.click('#review');
  await expect(panel.locator('#status')).toContainText('OpenAI answered 1 of', { timeout: 15000 });
  await expect(target.locator('#q2')).toHaveValue('Days');
  expect(posts).toHaveLength(1);
  expect(posts[0].headers.authorization).toBe('Bearer fake-openai-key-for-mocked-test');
  expect(posts[0].body.model).toBe('fake-openai-model');

  await options.selectOption('#claude-mode', 'codex');
  await options.click('#claude-save');
  await expect(options.locator('#claude-status')).toHaveText('Saved.');
  await panel.bringToFront();
  await panel.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.locator('#review')).toHaveText('Review missed with Codex');
  const logs = await readLogs(options);
  expect(logs).not.toContain('fake-openai-key-for-mocked-test');

  await panel.click('#undo');
  await context.unroute('https://api.openai.com/**');
  await target.close();
  await panel.close();
  await options.close();
});

test('sends a bug report the user can read first, with no personal values in it', async ({ shared: context, extensionId }) => {
  const posts: { body: string; method: string }[] = [];
  await context.route('https://rote.walker-computers.com/**', async (route) => {
    posts.push({ body: route.request().postData() ?? '', method: route.request().method() });
    await route.fulfill({ status: 201, json: { id: '20261109-abcd1234' } });
  });

  const { target, panel } = await openPanelFor(context, extensionId, `${BASE}/review.html`);
  await expect(panel.locator('h1')).toHaveText('Rote');
  await expect(panel.locator('#donate a')).toHaveAttribute('href', 'https://buymeacoffee.com/SethWalker234');
  const [options] = await Promise.all([context.waitForEvent('page'), panel.click('#bug')]);
  await expect(options).toHaveURL(/options\.html#bug$/);
  await expect(options.locator('#bug-send')).toBeVisible();
  await expect(options.locator('#bug h2')).toBeInViewport();
  await expect(options.locator('#bug-text')).toBeFocused();
  await expect(options.locator('#donate a')).toHaveAttribute('href', 'https://buymeacoffee.com/SethWalker234');

  await options.click('#bug-send');
  await expect(options.locator('#bug-status')).toHaveText('Describe what went wrong before sending.');
  expect(posts).toHaveLength(0);

  await options.fill('#bug-text', 'The shift list stayed empty after Fill form.');
  await options.click('#bug-send');
  await expect(options.locator('#bug-status')).toHaveText('Click Preview report and read it before sending.');
  expect(posts).toHaveLength(0);

  await options.click('#bug-preview');
  const preview = options.locator('#bug-view');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('The shift list stayed empty after Fill form.');
  await expect(preview).toContainText('field.matched');
  await expect(preview).not.toContainText(EMAIL);
  await expect(preview).not.toContainText('fake-openai-key-for-mocked-test');
  expect(posts).toHaveLength(0);

  await options.click('#bug-send');
  await expect(options.locator('#bug-status')).toHaveText('Sent. Your report ID is 20261109-abcd1234.');
  await expect(options.locator('#bug-text')).toHaveValue('');
  expect(posts).toHaveLength(1);
  expect(posts[0].method).toBe('POST');
  expect(posts[0].body).toContain('The shift list stayed empty after Fill form.');
  expect(posts[0].body).toContain('name="report"; filename="report.zip"');
  expect(posts[0].body).not.toContain(EMAIL);

  await context.unroute('https://rote.walker-computers.com/**');
  await target.close();
  await panel.close();
  await options.close();
});

test('guides the bridge setup, links to key pages and offers the OpenRouter sign-in', async ({ shared: context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.selectOption('#claude-mode', 'bridge');
  await expect(options.locator('#bridge-setup')).toBeVisible();
  // The answer depends on whether the PC running the tests has the bridge registered for this extension ID.
  const bridge = options.locator('#bridge-status');
  await expect(bridge).toContainText(/not set up on this PC yet|different copy of this extension|The bridge is set up/);
  await expect(options.locator('#bridge-command')).toHaveText(`powershell -ExecutionPolicy Bypass -File bridge\\install.ps1 -ExtensionId ${extensionId}`);
  // The message for a bridge set up for another copy also starts with "The bridge is set up", so match the two missing states.
  const ready = !/not set up on this PC yet|different copy of this extension/.test((await bridge.textContent())!);
  await expect(options.locator('#bridge-copy')).toBeVisible({ visible: !ready });
  if (ready) await expect(bridge).toContainText('Claude Code');
  await options.selectOption('#claude-mode', 'codex');
  await expect(options.locator('#bridge-setup')).toBeVisible();
  if (ready) await expect(bridge).toContainText(/Codex (is installed|was not found)/);

  await options.selectOption('#claude-mode', 'api');
  await expect(options.locator('#bridge-setup')).toBeHidden();
  await expect(options.locator('#claude-api-fields a')).toHaveAttribute('href', 'https://console.anthropic.com/settings/keys');

  await options.selectOption('#claude-mode', 'openai');
  await options.selectOption('#ai-provider', 'groq');
  await expect(options.locator('#ai-key-link')).toHaveAttribute('href', 'https://console.groq.com/keys');
  await expect(options.locator('#openrouter-row')).toBeHidden();
  await options.selectOption('#ai-provider', 'ollama');
  await expect(options.locator('#ai-key-link')).toBeHidden();

  await options.selectOption('#ai-provider', 'openrouter');
  await expect(options.locator('#ai-key-link')).toHaveAttribute('href', 'https://openrouter.ai/keys');
  // The sign-in itself is covered in the unit tests. A tab the extension opens loads before
  // Playwright can mock it, so clicking the button here would reach the real openrouter.ai.
  await expect(options.locator('#openrouter-signin')).toBeEnabled();
  await options.close();
});
