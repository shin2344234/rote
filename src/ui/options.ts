// Profile editor, resume intake, answer bank and log tools.
import { CATALOG, GROUP_TITLES, type CatalogEntry, type Group } from '../engine/catalog';
import { profileGaps } from '../engine/plan';
import * as store from '../shared/db';
import { MODELS, bridgeStatus, testClaude } from '../shared/claude';
import { DEFAULT_MODEL as OPENROUTER_MODEL, signIn } from '../shared/openrouter';
import { CODEX_LOCAL, PRESETS, activeModel, codexModel, presetFor, testProvider, usesProvider } from '../shared/providers';
import { createLogger, errorData, newRunId } from '../shared/log';
import { buildReport, previewText, sendReport, type Report } from '../shared/report';
import type { ClaudeMode, ClaudeSettings, EducationEntry, ParsedResume, Profile, ProviderConfig, StoredResume, WorkEntry } from '../shared/types';
import { extractText } from '../parser/extract';
import { parseResumeText } from '../parser/parse';
import { byId, h } from './dom';

let runId: string | undefined;
const log = createLogger('options', () => runId);
let draft: Profile = store.emptyProfile();
let dirty = false;

self.addEventListener('unhandledrejection', (event) => log.error('unhandled', errorData(event.reason)));

const WORK_FIELDS: [keyof WorkEntry, string][] = [['company', 'Company'], ['title', 'Job title'], ['location', 'Location'], ['start', 'Start (YYYY-MM)'], ['end', 'End (YYYY-MM)']];
const EDU_FIELDS: [keyof EducationEntry, string][] = [['school', 'School'], ['degree', 'Degree'], ['field', 'Field of study'], ['gpa', 'GPA'], ['start', 'Start (YYYY-MM)'], ['end', 'End (YYYY-MM)']];

function markDirty(): void {
  dirty = true;
  const status = document.getElementById('save-status');
  if (status) status.textContent = 'Unsaved changes';
}

function renderGaps(): void {
  const gaps = profileGaps(draft);
  const fromResume = gaps.filter((gap) => gap.source === 'resume');
  const answers = gaps.filter((gap) => gap.source === 'answer');
  const list = (items: typeof gaps) => h('ul', { class: 'plain' }, ...items.map((gap) => h('li', {}, gap.label)));
  byId('gaps').replaceChildren(
    h('h2', {}, 'What your profile still needs'),
    gaps.length ? '' : h('p', { class: 'muted' }, 'Nothing is missing.'),
    fromResume.length ? h('h3', {}, 'Not found in your resume') : '',
    fromResume.length ? list(fromResume) : '',
    answers.length ? h('h3', {}, 'Applications ask for these, and a resume does not contain them') : '',
    answers.length ? list(answers) : '',
  );
}

function fieldInput(entry: CatalogEntry) {
  const value = draft.fields[entry.key] ?? '';
  const update = (event: Event) => {
    const next = (event.target as HTMLInputElement).value;
    if (next) draft.fields[entry.key] = next;
    else delete draft.fields[entry.key];
    markDirty();
    renderGaps();
  };
  if (entry.choices) {
    const labels: Record<string, string> = { decline: 'Decline to answer', yes: 'Yes', no: 'No', 'not a veteran': 'Not a veteran', veteran: 'Veteran' };
    return h('select', { 'data-key': entry.key, change: update },
      h('option', { value: '' }, 'Not set'),
      ...entry.choices.map((choice) => h('option', { value: choice, selected: choice === value }, labels[choice] ?? choice)));
  }
  return h('input', { 'data-key': entry.key, value, input: update });
}

function renderEntries<T extends object>(title: string, list: T[], columns: [keyof T, string][], blank: () => T, extras?: (item: T) => Node[]) {
  const section = h('section', { class: 'card', 'data-section': title });
  const draw = () => {
    section.replaceChildren(
      h('div', { class: 'actions spread' }, h('h2', {}, title),
        h('button', { type: 'button', class: 'small', click: () => { list.push(blank()); markDirty(); draw(); renderGaps(); } }, 'Add')),
      ...list.map((item, index) => h('div', { class: 'entry' },
        h('div', { class: 'grid' },
          ...columns.map(([key, label]) => h('label', {}, h('span', {}, label),
            h('input', { value: String(item[key] ?? ''), input: (event: Event) => { (item[key] as string) = (event.target as HTMLInputElement).value; markDirty(); } }))),
          ...(extras?.(item) ?? [])),
        h('button', { type: 'button', class: 'small', style: 'margin-top:6px', click: () => { list.splice(index, 1); markDirty(); draw(); renderGaps(); } }, 'Remove'))),
    );
  };
  draw();
  return section;
}

function renderProfile(): void {
  const form = byId<HTMLFormElement>('profile');
  const simple = CATALOG.filter((entry) => !entry.repeat && entry.source !== 'file' && entry.key !== 'skills');
  const groups = [...new Set(simple.map((entry) => entry.group))] as Group[];
  const sections = groups.map((group) => h('section', { class: 'card', 'data-section': group },
    h('h2', {}, GROUP_TITLES[group]),
    h('div', { class: 'grid' }, ...simple.filter((entry) => entry.group === group).map((entry) =>
      entry.key === 'summary'
        ? h('label', { class: 'wide' }, h('span', {}, entry.label), h('textarea', { rows: '4', 'data-key': entry.key, value: draft.fields[entry.key] ?? '', input: (event: Event) => { draft.fields.summary = (event.target as HTMLTextAreaElement).value; markDirty(); } }))
        : h('label', {}, h('span', {}, entry.label), fieldInput(entry))))));

  const work = renderEntries('Work history', draft.work, WORK_FIELDS,
    () => ({ company: '', title: '', location: '', start: '', end: '', current: false, description: '' }),
    (job) => [
      h('label', {}, h('span', {}, 'Current job'), h('input', { type: 'checkbox', checked: job.current, change: (event: Event) => { job.current = (event.target as HTMLInputElement).checked; markDirty(); } })),
      h('label', { class: 'wide' }, h('span', {}, 'Description'), h('textarea', { rows: '3', value: job.description, input: (event: Event) => { job.description = (event.target as HTMLTextAreaElement).value; markDirty(); } })),
    ]);
  const education = renderEntries('Education', draft.education, EDU_FIELDS, () => ({ school: '', degree: '', field: '', gpa: '', start: '', end: '' }));
  const skills = h('section', { class: 'card' }, h('h2', {}, 'Skills'),
    h('textarea', { rows: '3', 'aria-label': 'Skills, comma separated', value: draft.skills.join(', '), input: (event: Event) => {
      draft.skills = (event.target as HTMLTextAreaElement).value.split(',').map((skill) => skill.trim()).filter(Boolean);
      markDirty();
      renderGaps();
    } }));

  form.replaceChildren(...sections, work, education, skills, h('div', { class: 'savebar' },
    h('button', { id: 'save', type: 'submit', class: 'primary' }, 'Save profile'),
    h('span', { id: 'save-status', class: 'muted' }, dirty ? 'Unsaved changes' : '')));
  renderGaps();
}

async function saveProfile(event: Event): Promise<void> {
  event.preventDefault();
  await store.saveProfile(draft);
  // The work and education controls hold references into this draft, so it has to stay the same object.
  draft.updatedAt = Date.now();
  dirty = false;
  byId('save-status').textContent = 'Saved';
  log.info('profile.saved', { fields: Object.keys(draft.fields).length, work: draft.work.length, education: draft.education.length, skills: draft.skills.length });
}

function applyParsed(parsed: ParsedResume): void {
  draft = {
    ...draft,
    fields: { ...draft.fields, ...parsed.profile.fields },
    work: parsed.profile.work.length ? parsed.profile.work : draft.work,
    education: parsed.profile.education.length ? parsed.profile.education : draft.education,
    skills: parsed.profile.skills.length ? parsed.profile.skills : draft.skills,
  };
  dirty = true;
  renderProfile();
}

function renderParseReport(name: string, parsed: ParsedResume, applied: boolean): void {
  const found = parsed.findings.filter((finding) => finding.found).map((finding) => finding.field);
  const missing = parsed.findings.filter((finding) => !finding.found).map((finding) => finding.field);
  byId('parse-report').replaceChildren(h('div', { id: 'parse-result', style: 'margin-top:10px' },
    h('h3', {}, `Parsed ${name}`),
    h('div', {}, `Found: ${found.join(', ') || 'nothing'}`),
    h('div', { class: 'muted' }, `Not found: ${missing.join(', ') || 'nothing'}`),
    ...parsed.warnings.map((warning) => h('div', { class: 'note' }, warning)),
    applied
      ? h('div', { class: 'note' }, 'Loaded into the form below. Check it, then click Save profile.')
      : h('button', { type: 'button', style: 'margin-top:6px', click: (event: Event) => { applyParsed(parsed); (event.target as HTMLButtonElement).disabled = true; } }, 'Replace profile data with this resume'),
  ));
}

async function parseFile(name: string, bytes: ArrayBuffer): Promise<ParsedResume> {
  const { text, warnings } = await extractText(name, bytes);
  log.debug('resume.rawText', { rawText: text, characters: text.length });
  const parsed = parseResumeText(text, warnings);
  log.info('resume.parsed', { findings: parsed.findings, warnings: parsed.warnings, sections: parsed.sections, jobs: parsed.profile.work.length, schools: parsed.profile.education.length, skills: parsed.profile.skills.length });
  return parsed;
}

// Runs the current parser on the stored file. The result stays in the form until Save profile.
async function reparse(resume: StoredResume): Promise<void> {
  runId = newRunId();
  log.info('resume.reparse', { extension: resume.name.split('.').pop(), size: resume.size });
  try {
    const parsed = await parseFile(resume.name, resume.bytes);
    applyParsed(parsed);
    renderParseReport(resume.name, parsed, true);
  } catch (error) {
    log.error('resume.failed', errorData(error));
    byId('parse-report').replaceChildren(h('div', { class: 'note error' }, `Could not read ${resume.name}: ${(error as Error).message}`));
  }
  await renderLogs();
}

async function ingest(file: File): Promise<void> {
  runId = newRunId();
  log.info('resume.received', { extension: file.name.split('.').pop(), size: file.size, mime: file.type });
  const bytes = await file.arrayBuffer();
  try {
    const parsed = await parseFile(file.name, bytes);
    await store.addResume({ id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, bytes, addedAt: Date.now(), isDefault: false });
    await renderResumes();
    const empty = !draft.updatedAt && !Object.keys(draft.fields).length;
    if (empty) applyParsed(parsed);
    renderParseReport(file.name, parsed, empty);
  } catch (error) {
    log.error('resume.failed', errorData(error));
    byId('parse-report').replaceChildren(h('div', { class: 'note error' }, `Could not read ${file.name}: ${(error as Error).message}`));
  }
}

async function renderResumes(): Promise<void> {
  const resumes = await store.listResumes();
  byId('resumes').replaceChildren(...resumes.map((resume) => h('div', { class: 'list-row' },
    h('span', {}, `${resume.name} (${Math.round(resume.size / 1024)} KB)`),
    h('span', { class: 'actions' },
      h('label', {}, h('input', { type: 'radio', name: 'default-resume', checked: resume.isDefault, change: async () => { await store.setDefaultResume(resume.id); await renderResumes(); } }), ' Default'),
      h('button', { type: 'button', class: 'small', click: () => reparse(resume) }, 'Reparse'),
      h('button', { type: 'button', class: 'small', click: async () => { await store.deleteResume(resume.id); await renderResumes(); } }, 'Delete')))));
}

async function renderAnswers(): Promise<void> {
  const answers = await store.listAnswers();
  byId('answers').replaceChildren(...(answers.length ? answers.map((answer) => h('div', { class: 'list-row' },
    h('span', {}, h('strong', {}, answer.question), h('div', { class: 'muted' }, answer.answer)),
    h('button', { type: 'button', class: 'small', click: async () => { await store.deleteAnswer(answer.id); await renderAnswers(); } }, 'Delete'))) : [h('p', { class: 'muted' }, 'No saved answers yet.')]));
}

async function renderLogs(): Promise<void> {
  const logs = await store.readLogs();
  byId('log-count').textContent = `${logs.length} entries`;
  byId('log-view').textContent = logs.slice(-200).reverse()
    .map((entry) => `${new Date(entry.ts).toLocaleTimeString()} ${entry.level.toUpperCase()} ${entry.scope}.${entry.event} ${entry.data ? JSON.stringify(entry.data) : ''}`)
    .join('\n');
}

async function exportLogs(): Promise<void> {
  const logs = await store.readLogs();
  const blob = new Blob([logs.map((entry) => JSON.stringify(entry)).join('\n')], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: `rote-log-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.jsonl` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function initClaude(): Promise<void> {
  const mode = byId<HTMLSelectElement>('claude-mode');
  const key = byId<HTMLInputElement>('claude-key');
  const model = byId<HTMLSelectElement>('claude-model');
  const status = byId('claude-status');
  model.replaceChildren(...MODELS.map(([id, name]) => h('option', { value: id }, name)));

  const provider = byId<HTMLSelectElement>('ai-provider');
  const base = byId<HTMLInputElement>('ai-base');
  const otherKey = byId<HTMLInputElement>('ai-key');
  const otherModel = byId<HTMLInputElement>('ai-model');
  const modelList = byId('ai-models');
  const codex = byId<HTMLInputElement>('codex-model');
  provider.replaceChildren(...PRESETS.map((preset) => h('option', { value: preset.id }, preset.name)));

  const saved = await store.getClaudeSettings();
  mode.value = saved.mode;
  key.value = saved.apiKey;
  model.value = saved.model;
  // Each provider keeps its own key, model and base URL, so switching between them loses nothing.
  const providers: Record<string, ProviderConfig> = { ...saved.providers };
  let shown = presetFor(saved.provider).id;
  provider.value = shown;
  codex.value = codexModel(saved);

  const stash = () => {
    providers[shown] = { apiKey: otherKey.value.trim(), model: otherModel.value.trim(), baseUrl: base.value.trim() };
    providers[CODEX_LOCAL] = { apiKey: '', model: codex.value.trim(), baseUrl: '' };
  };
  const showProvider = () => {
    const preset = presetFor(provider.value);
    const config = providers[preset.id];
    shown = preset.id;
    base.value = config?.baseUrl || preset.baseUrl;
    otherKey.value = config?.apiKey ?? '';
    otherModel.value = config?.model ?? '';
    modelList.replaceChildren();
    // A custom server may or may not want a key, so its key box stays visible.
    byId('ai-key-row').hidden = !preset.needsKey && preset.id !== 'custom';
    byId('ai-local-note').hidden = !preset.local;
    byId('openrouter-row').hidden = preset.id !== 'openrouter';
    const link = byId<HTMLAnchorElement>('ai-key-link');
    link.hidden = !preset.keyUrl;
    if (preset.keyUrl) link.href = preset.keyUrl;
    link.textContent = `Get a key from ${preset.name}`;
  };
  let bridgeCheck = 0;
  // Shows whether this PC has the bridge and the two tools, and the exact command when it does not.
  const checkBridge = async () => {
    const line = byId('bridge-status');
    const check = ++bridgeCheck;
    line.textContent = 'Checking this PC...';
    const found = await bridgeStatus();
    // A newer check, or a switch to another connection, makes this answer stale.
    if (check !== bridgeCheck || (mode.value !== 'bridge' && mode.value !== 'codex')) return;
    const tool = mode.value === 'codex' ? 'Codex' : 'Claude Code';
    const needsInstall = found.state === 'missing' || found.state === 'wrong-id';
    byId('bridge-install').hidden = !needsInstall;
    byId('bridge-copy').hidden = !needsInstall;
    if (found.state !== 'ready') {
      line.textContent = {
        missing: 'The bridge that lets Rote reach Claude Code and Codex is not set up on this PC yet.',
        'wrong-id': 'The bridge is set up for a different copy of this extension. Run the command below to allow this one.',
        failed: `The bridge is set up but did not answer. ${found.detail}`,
      }[found.state];
    } else {
      const has = (mode.value === 'codex' ? found.codex : found.claude).found;
      const other = mode.value === 'codex' ? `Claude Code is ${found.claude.found ? 'also installed' : 'not installed'}.` : `Codex is ${found.codex.found ? 'also installed' : 'not installed'}.`;
      line.textContent = has
        ? `Ready. The bridge is set up and ${tool} is installed. ${other}`
        : `The bridge is set up, but ${tool} was not found on this PC. Install ${tool}, sign in to it, then click Check again. ${other}`;
    }
    log.info('bridge.status', { state: found.state, claude: found.state === 'ready' && found.claude.found, codex: found.state === 'ready' && found.codex.found });
  };
  const command = `pwsh -ExecutionPolicy Bypass -File bridge\\install.ps1 -ExtensionId ${chrome.runtime.id}`;
  byId('bridge-command').textContent = command;
  const showFields = () => {
    const openaiOnly = mode.value === 'codex-api';
    // The OpenAI key connection is the OpenAI preset with the provider and base URL boxes put away.
    if (openaiOnly && shown !== 'openai') {
      stash();
      provider.value = 'openai';
      showProvider();
    }
    byId('claude-api-fields').hidden = mode.value !== 'api';
    byId('claude-bridge-fields').hidden = mode.value !== 'bridge';
    byId('codex-bridge-fields').hidden = mode.value !== 'codex';
    byId('ai-other-fields').hidden = mode.value !== 'openai' && !openaiOnly;
    byId('ai-provider-row').hidden = openaiOnly;
    byId('ai-custom-note').hidden = openaiOnly;
    byId('claude-model-row').hidden = mode.value !== 'api' && mode.value !== 'bridge' && mode.value !== 'off';
    const local = mode.value === 'bridge' || mode.value === 'codex';
    byId('bridge-setup').hidden = !local;
    if (local) void checkBridge();
  };
  const persist = async (): Promise<ClaudeSettings> => {
    stash();
    const settings: ClaudeSettings = { mode: mode.value as ClaudeMode, apiKey: key.value.trim(), model: model.value, provider: shown, providers: { ...providers } };
    await store.saveClaudeSettings(settings);
    const hasKey = Boolean(usesProvider(settings) ? providers[shown].apiKey : settings.mode === 'api' && settings.apiKey);
    log.info('claude.settings', { mode: settings.mode, model: activeModel(settings), provider: usesProvider(settings) ? shown : undefined, hasKey });
    return settings;
  };
  showProvider();
  showFields();
  mode.addEventListener('change', showFields);
  provider.addEventListener('change', () => {
    stash();
    showProvider();
    status.textContent = '';
  });
  byId('claude-save').addEventListener('click', async () => {
    await persist();
    status.textContent = 'Saved.';
  });
  const runTest = async () => {
    status.textContent = 'Testing...';
    try {
      const settings = await persist();
      if (usesProvider(settings)) {
        const result = await testProvider(settings);
        modelList.replaceChildren(...result.models.map((id) => h('option', { value: id })));
        status.textContent = result.message;
        // A server with one model leaves nothing to choose, which is the usual case for a local one.
        if (!otherModel.value.trim() && result.models.length === 1) {
          otherModel.value = result.models[0];
          await persist();
          status.textContent = `Connected. Picked ${result.models[0]}, the only model on offer, and saved it.`;
        }
      } else {
        status.textContent = await testClaude(settings);
      }
    } catch (error) {
      log.warn('claude.testFailed', errorData(error));
      status.textContent = (error as Error).message;
    }
  };
  byId('claude-test').addEventListener('click', runTest);
  // A pasted key is checked right away, so a bad one shows before the first review.
  for (const box of [key, otherKey]) box.addEventListener('paste', () => setTimeout(runTest, 0));
  byId('bridge-check').addEventListener('click', checkBridge);
  byId('bridge-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(command);
    byId('bridge-status').textContent = 'Copied. Paste it into PowerShell in the unzipped rote-bridge folder, then click Check again.';
  });
  const signInButton = byId<HTMLButtonElement>('openrouter-signin');
  signInButton.addEventListener('click', async () => {
    signInButton.disabled = true;
    status.textContent = 'Waiting for you to approve Rote on openrouter.ai...';
    try {
      otherKey.value = await signIn();
      if (!otherModel.value.trim()) otherModel.value = OPENROUTER_MODEL;
      log.info('openrouter.signedIn', { model: otherModel.value });
      await runTest();
      if (!/rejected|Could not/.test(status.textContent ?? '')) status.textContent = `Signed in to OpenRouter and saved. Using ${otherModel.value}.`;
    } catch (error) {
      log.warn('openrouter.signInFailed', errorData(error));
      status.textContent = (error as Error).message;
    } finally {
      signInButton.disabled = false;
    }
  });
  // The controls start disabled so a choice made while settings load can't be overwritten by them.
  for (const id of ['claude-mode', 'claude-model', 'claude-save', 'claude-test', 'ai-provider', 'ai-base', 'ai-key', 'ai-model', 'codex-model', 'openrouter-signin']) {
    byId<HTMLSelectElement | HTMLInputElement | HTMLButtonElement>(id).disabled = false;
  }
}

function initBugReport(): void {
  const text = byId<HTMLTextAreaElement>('bug-text');
  const contact = byId<HTMLInputElement>('bug-contact');
  const view = byId('bug-view');
  const status = byId('bug-status');
  const send = byId<HTMLButtonElement>('bug-send');

  const build = async (): Promise<Report> => buildReport({
    description: text.value,
    contact: contact.value,
    logs: await store.readLogs(),
    settings: await store.getClaudeSettings(),
    version: chrome.runtime.getManifest().version,
    browser: navigator.userAgent,
  });
  byId('bug-preview').addEventListener('click', async () => {
    view.textContent = previewText(await build());
    view.hidden = false;
  });
  send.addEventListener('click', async () => {
    if (!text.value.trim()) {
      status.textContent = 'Describe what went wrong before sending.';
      return;
    }
    send.disabled = true;
    status.textContent = 'Sending...';
    try {
      const report = await build();
      const id = await sendReport(report);
      log.info('report.sent', { id, logEntries: report.logLines.length });
      status.textContent = `Sent. Your report ID is ${id}.`;
      text.value = '';
      view.hidden = true;
    } catch (error) {
      log.warn('report.failed', errorData(error));
      status.textContent = (error as Error).message;
    } finally {
      send.disabled = false;
    }
  });
}

// The profile form and lists render after the page loads and push the section down, so this runs last.
function showBugSection(): void {
  if (location.hash !== '#bug') return;
  byId('bug').scrollIntoView();
  byId<HTMLTextAreaElement>('bug-text').focus({ preventScroll: true });
}

async function init(): Promise<void> {
  await initClaude();
  initBugReport();
  draft = await store.getProfile();
  renderProfile();
  await Promise.all([renderResumes(), renderAnswers(), renderLogs()]);

  byId<HTMLFormElement>('profile').addEventListener('submit', saveProfile);
  byId<HTMLInputElement>('upload').addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) await ingest(input.files[0]);
    input.value = '';
    await renderLogs();
  });

  const debug = byId<HTMLInputElement>('debug');
  debug.checked = (await store.debugUntil()) > Date.now();
  debug.addEventListener('change', async () => {
    await store.setDebugLogging(debug.checked);
    log.info('debug.toggled', { on: debug.checked });
  });
  byId('log-refresh').addEventListener('click', renderLogs);
  byId('log-export').addEventListener('click', exportLogs);
  byId('log-clear').addEventListener('click', async () => { await store.clearLogs(); await renderLogs(); });
  addEventListener('beforeunload', (event) => { if (dirty) event.preventDefault(); });
  addEventListener('hashchange', showBugSection);
  showBugSection();
}

void init();
