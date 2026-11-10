// Side panel. Runs the scan, plan, upload, fill sequence and shows the field report.
import { buildPlan, profileGaps } from '../engine/plan';
import { CATALOG_BY_KEY } from '../engine/catalog';
import { PLACEHOLDER_OPTION, savedChoices } from '../engine/options';
import { normalize } from '../engine/text';
import { canDraft, DRAFT_SYSTEM, needsReview, parseReview, questionId, REVIEW_SCHEMA, REVIEW_SYSTEM, reviewPrompt, usableOptions, type ReviewAnswer, type ReviewQuestion } from '../engine/review';
import { askClaude } from '../shared/claude';
import { activeModel, providerName } from '../shared/providers';
import { getClaudeSettings, getProfile, listAnswers, listResumes, putAnswer } from '../shared/db';
import { createLogger, errorData, newRunId, stripUrl } from '../shared/log';
import type { ClaudeSettings, ContentRequest, FillItem, FillResult, PlanRow, ScannedField, StoredResume } from '../shared/types';
import { byId, h } from './dom';

let runId = '';
const log = createLogger('panel', () => runId);

let rows: PlanRow[] = [];
let fields: ScannedField[] = [];
let tabId = 0;
let frames: number[] = [];
let resumes: StoredResume[] = [];
let notice: { text: string; error: boolean } | null = null;
let watchToken = 0;
let busy = 0;
let drafting: PlanRow | null = null;
let ai = 'Claude';

const FILLABLE = new Set(['ready', 'low', 'confirm']);
// Forms that parse an upload on their server can rewrite themselves long after the page looks idle.
const WATCH_AFTER_UPLOAD_MS = 45000;
const WATCH_MS = 8000;
const MAX_RESTORES = 3;

self.addEventListener('unhandledrejection', (event) => log.error('unhandled', errorData(event.reason)));

function setNotice(text: string, error = false): void {
  notice = text ? { text, error } : null;
  const status = byId('status');
  status.replaceChildren();
  if (notice) status.append(h('div', { class: `note${error ? ' error' : ''}`, role: 'status' }, text));
}

async function targetTab(): Promise<number> {
  const override = new URLSearchParams(location.search).get('tabId');
  if (override) return Number(override);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab.id;
}

async function send<T>(frameId: number, request: ContentRequest): Promise<T | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, request, { frameId });
    if (!response?.ok) {
      log.error('frame.requestFailed', { frameId, type: request.type, error: response?.error });
      return undefined;
    }
    return response.result as T;
  } catch (error) {
    log.warn('frame.unreachable', { frameId, type: request.type, ...errorData(error) });
    return undefined;
  }
}

function selectedResume(): StoredResume | undefined {
  const id = byId<HTMLSelectElement>('resume').value;
  return resumes.find((resume) => resume.id === id);
}

async function scanFrames(): Promise<void> {
  const injected = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  frames = [...new Set(injected.map((result) => result.frameId))];
  const perFrame = await Promise.all(frames.map((frameId) => send<ScannedField[]>(frameId, { type: 'scan', runId, frameId })));
  fields = perFrame.flatMap((list) => list ?? []);
  rows = buildPlan(fields, { profile: await getProfile(), bank: await listAnswers(), resumeName: selectedResume()?.name });
  log.info('scan.done', { frames: frames.length, fields: fields.length, statuses: countBy(rows.map((row) => row.status)) });
  logRows();
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

// One entry per field, complete enough to write a new matching rule from.
function logRows(): void {
  for (const row of rows) {
    const field = fields.find((candidate) => candidate.fieldId === row.fieldId && candidate.frameId === row.frameId)!;
    const event = row.key ? 'field.matched' : row.status === 'blocked' ? 'field.blocked' : 'field.unmatched';
    log[row.key || row.status === 'blocked' ? 'debug' : 'warn'](event, {
      fieldId: row.fieldId, frameId: row.frameId, frameUrl: field.frameUrl, kind: field.kind, tag: field.tag, role: field.role,
      domPath: field.domPath, required: field.required, hasValue: field.hasValue, signals: field.signals, optionLabels: field.options.slice(0, 60),
      key: row.key, index: row.index, score: row.score, status: row.status, reason: row.reason, candidates: row.candidates, value: row.value,
    });
  }
}

function updateButtons(): void {
  // A rescan during a draft would renumber the fields, and the reply could land in the wrong one.
  if (drafting || busy) return;
  byId<HTMLButtonElement>('scan').disabled = false;
  byId<HTMLButtonElement>('fill').disabled = !rows.some((row) => FILLABLE.has(row.status) && !row.result);
  byId<HTMLButtonElement>('undo').disabled = !rows.some((row) => row.result?.ok);
  byId<HTMLButtonElement>('review').disabled = !reviewTargets().length;
}

const fieldFor = (row: PlanRow) => fields.find((field) => field.fieldId === row.fieldId && field.frameId === row.frameId);
const reviewTargets = () => rows.filter((row) => needsReview(row, fieldFor(row)));

function guard(task: () => Promise<void>) {
  return async () => {
    const buttons = ['scan', 'fill', 'undo', 'review'].map((id) => byId<HTMLButtonElement>(id));
    buttons.forEach((button) => (button.disabled = true));
    busy++;
    render();
    try {
      setNotice('');
      await task();
    } catch (error) {
      log.error('action.failed', errorData(error));
      const message = (error as Error).message ?? String(error);
      setNotice(/cannot access|chrome:|extensions gallery/i.test(message) ? 'Chrome does not allow extensions on this page.' : message, true);
    } finally {
      busy--;
      updateButtons();
      render();
    }
  };
}

async function scan(): Promise<void> {
  watchToken++;
  runId = newRunId();
  tabId = await targetTab();
  const tab = await chrome.tabs.get(tabId);
  log.info('scan.start', { pageUrl: stripUrl(tab.url ?? ''), version: chrome.runtime.getManifest().version });
  await loadResumes();
  await scanFrames();
  if (!fields.length) setNotice('No form fields found. If this is a multi-step form, open the step with fields and scan again.');
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function upload(): Promise<FillResult | undefined> {
  const row = rows.find((candidate) => candidate.key === 'resumeUpload' && (candidate.status === 'ready' || candidate.status === 'low'));
  const resume = selectedResume();
  if (!row || !resume) {
    log.info('upload.skipped', { hasRow: Boolean(row), hasResume: Boolean(resume) });
    return undefined;
  }
  // A second upload would make a parsing form rewrite itself all over again.
  if ((await send<string>(row.frameId, { type: 'uploaded', runId })) === resume.id) {
    log.info('upload.alreadySent', { fieldId: row.fieldId });
    return { fieldId: row.fieldId, ok: true, detail: 'already attached earlier on this page' };
  }
  const request: ContentRequest = {
    type: 'upload', runId, fieldId: row.fieldId, mark: row.status === 'ready' ? 'ok' : 'low',
    file: { id: resume.id, name: resume.name, type: resume.type, base64: toBase64(resume.bytes) },
  };
  const result = await send<FillResult>(row.frameId, request);
  if (!result) return undefined;
  // Many forms parse the file and rewrite themselves, so the page has to settle and be read again.
  const settled = await Promise.all(frames.map((frameId) => send(frameId, { type: 'settle', runId })));
  log.info('upload.settled', { ok: result.ok, detail: result.detail, settled });
  return result;
}

async function fillRows(targets: PlanRow[]): Promise<FillResult[]> {
  const results: FillResult[] = [];
  for (const frameId of frames) {
    const items: FillItem[] = targets
      .filter((row) => row.frameId === frameId)
      .map((row) => ({ fieldId: row.fieldId, key: row.key, kind: row.kind, value: row.value, overwrite: false, mark: row.status === 'ready' ? 'ok' : row.status === 'confirm' ? 'confirm' : 'low', place: row.place }));
    if (!items.length) continue;
    const frameResults = await send<FillResult[]>(frameId, { type: 'fill', runId, items });
    for (const result of frameResults ?? []) {
      const row = rows.find((candidate) => candidate.frameId === frameId && candidate.fieldId === result.fieldId);
      if (row) row.result = result;
      results.push(result);
    }
  }
  return results;
}

const rowIdentity = (row: PlanRow) => `${row.frameId}|${row.key}|${row.index}|${row.label}`;

// Field numbers change on a rescan, so rows are matched by what they are.
// The old rows are read after the scan so that an Undo during it still counts.
async function rescanKeeping(keep: (row: PlanRow) => boolean): Promise<void> {
  const old = rows;
  await scanFrames();
  const kept = new Map(old.filter(keep).map((row) => [rowIdentity(row), row]));
  for (const row of rows) {
    const before = kept.get(rowIdentity(row));
    if (before) Object.assign(row, { status: before.status, value: before.value, reason: before.reason, result: before.result, confirmed: before.confirmed, claude: before.claude });
  }
}

async function restoreLost(lost: PlanRow[], token: number): Promise<void> {
  const lostIds = new Set(lost.map(rowIdentity));
  await Promise.all(frames.map((frameId) => send(frameId, { type: 'settle', runId })));
  if (token !== watchToken) return;
  await rescanKeeping((row) => Boolean(row.result || row.claude));
  if (token !== watchToken) return;
  const blank = rows.filter((row) => lostIds.has(rowIdentity(row)) && row.result?.ok && row.value);
  const results = await fillRows(blank.filter((row) => row.kind !== 'file'));
  log.info('watch.restored', { keys: blank.map((row) => row.key), succeeded: results.filter((result) => result.ok).length });
}

// Puts back values the page wipes after Fill, which happens when a slow resume parse finishes.
async function watchFilled(duration: number): Promise<void> {
  const token = ++watchToken;
  const deadline = Date.now() + duration;
  let restores = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (token !== watchToken) return;
    const filled = rows.filter((row) => row.result?.ok && row.kind !== 'file');
    const replies = await Promise.all(frames.map(async (frameId) => {
      const fields = filled.filter((row) => row.frameId === frameId).map((row) => ({ fieldId: row.fieldId, chosen: row.result!.chosen }));
      return fields.length ? { frameId, lost: await send<string[]>(frameId, { type: 'check', runId, fields }) } : null;
    }));
    if (token !== watchToken) return;
    const answered = replies.filter((reply) => reply?.lost);
    if (!answered.length) return;
    const lost = filled.filter((row) => answered.some((reply) => reply!.frameId === row.frameId && reply!.lost!.includes(row.fieldId)));
    if (!lost.length) continue;
    log.warn('watch.lost', { keys: lost.map((row) => row.key), restores });
    if (++restores > MAX_RESTORES) {
      setNotice(`The page keeps clearing ${lost.length} filled field(s). Check them before you submit.`, true);
      render();
      return;
    }
    await restoreLost(lost, token);
    if (token !== watchToken) return;
    setNotice(`The page cleared ${lost.length} field(s) after Fill. They were filled again.`);
    updateButtons();
    render();
  }
}

const MAX_ADDED_ROWS = 10;
const GROUPS = [
  { group: 'work' as const, prefix: 'work.', noun: ['work block', 'work blocks'] },
  { group: 'education' as const, prefix: 'edu.', noun: ['education block', 'education blocks'] },
];

// Forms like Greenhouse show one work block until "Add another" is clicked, so the rest of the profile had nowhere to go.
async function addMissingRows(): Promise<string[]> {
  const profile = await getProfile();
  const summary: string[] = [];
  for (const { group, prefix, noun } of GROUPS) {
    const wanted = group === 'work' ? profile.work.length : profile.education.length;
    let count = 0;
    for (let attempt = 0; attempt < MAX_ADDED_ROWS; attempt++) {
      const groupRows = rows.filter((row) => row.key.startsWith(prefix));
      if (!groupRows.length) break;
      const last = groupRows.reduce((best, row) => (row.index > best.index ? row : best));
      if (last.index + 1 >= wanted) break;
      const reply = await send<{ clicked: boolean; label: string }>(last.frameId, { type: 'addRow', runId, fieldId: last.fieldId, group });
      if (!reply?.clicked) {
        log.info('rows.noAddButton', { group, shown: last.index + 1, wanted });
        break;
      }
      await rescanKeeping((row) => Boolean(row.result || row.claude));
      const grown = rows.filter((row) => row.key.startsWith(prefix)).reduce((max, row) => Math.max(max, row.index), -1);
      if (grown <= last.index) {
        log.warn('rows.notGrown', { group, label: reply.label });
        break;
      }
      count++;
      await fillRows(rows.filter((row) => row.key.startsWith(prefix) && row.index > last.index && FILLABLE.has(row.status) && !row.result?.ok));
    }
    if (count) {
      log.info('rows.added', { group, count, wanted });
      summary.push(`${count} ${noun[count === 1 ? 0 : 1]}`);
    }
  }
  return summary;
}

async function fill(): Promise<void> {
  watchToken++;
  log.info('fill.start', { planned: countBy(rows.map((row) => row.status)) });
  const uploadResult = await upload();
  const uploadRowKey = uploadResult && 'resumeUpload';
  if (uploadResult) await rescanKeeping((row) => Boolean(row.claude));

  const results = await fillRows(rows.filter((row) => FILLABLE.has(row.status) && row.kind !== 'file' && !row.result?.ok));
  if (uploadRowKey) {
    const row = rows.find((candidate) => candidate.key === uploadRowKey);
    if (row) row.result = uploadResult;
  }
  const added = await addMissingRows();
  if (added.length) setNotice(`Rote added ${added.join(' and ')} so every entry in your profile has a place. Undo clears them but leaves the blocks on the page.`);
  const failed = rows.filter((row) => row.result && !row.result.ok);
  log.info('fill.done', {
    attempted: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: failed.map((row) => ({ key: row.key, kind: row.kind, detail: row.result!.detail })),
    uploaded: uploadResult?.ok ?? false,
    statuses: countBy(rows.map((row) => row.status)),
  });
  void watchFilled(uploadResult?.ok ? WATCH_AFTER_UPLOAD_MS : WATCH_MS).catch((error) => log.error('watch.failed', errorData(error)));
}

async function undo(): Promise<void> {
  watchToken++;
  const outcomes = await Promise.all(frames.map((frameId) => send<{ undone: number; notUndone: string[] }>(frameId, { type: 'undo', runId })));
  const notUndone = outcomes.flatMap((outcome) => outcome?.notUndone ?? []);
  log.info('undo.done', { undone: outcomes.reduce((sum, outcome) => sum + (outcome?.undone ?? 0), 0), notUndone });
  for (const row of rows) {
    // The rescan after an upload saw the file as already there, and Undo has just removed it.
    if (row.key === 'resumeUpload' && row.status === 'existing' && row.result?.ok) Object.assign(row, { status: 'ready', reason: '' });
    delete row.result;
    if (row.claude) {
      Object.assign(row, row.claude.before);
      delete row.claude;
    }
  }
  if (notUndone.length) setNotice(`${notUndone.length} custom control(s) can't be undone automatically. Reset them on the page.`);
}

// Sites often fill themselves from a resume or account after the scan, so the scan's view can be out of date.
async function dropAnswered(targets: PlanRow[]): Promise<number> {
  const current = await Promise.all(targets.map((row) => send<string>(row.frameId, { type: 'read', runId, fieldId: row.fieldId })));
  const answered = targets.filter((_, index) => !PLACEHOLDER_OPTION.test(current[index] ?? ''));
  for (const row of answered) {
    fieldFor(row)!.hasValue = true;
    delete row.result;
    row.status = 'existing';
    row.value = '';
    row.reason = 'The page already has a value.';
  }
  log.info('claude.review.fresh', { checked: targets.length, alreadyAnswered: answered.length });
  return answered.length;
}

const takesMany = (row: PlanRow) => row.kind === 'checkbox' || Boolean(fieldFor(row)?.multiple);

function questionFor(row: PlanRow): ReviewQuestion {
  return { id: questionId(row), label: row.label, kind: row.kind, required: row.required, options: usableOptions(fieldFor(row)), multiple: takesMany(row) };
}

function recordAnswer(row: PlanRow, answer: ReviewAnswer | undefined, options: string[], drafted = false): void {
  const before = row.claude?.before ?? { status: row.status, value: row.value, reason: row.reason };
  if (!answer) {
    row.claude = { state: 'unanswered', confidence: 'low', basis: '', edit: '', options, before, drafted };
    row.reason = drafted ? `${ai} could not draft a reply from your profile.` : `${ai} found no answer for this in your profile.`;
    return;
  }
  row.claude = { state: 'asking', confidence: answer.confidence, basis: answer.basis, edit: answer.answer, options, before, drafted };
  row.status = 'confirm';
  row.value = answer.answer;
  row.reason = '';
}

// The panel names whichever provider is selected, so the user can see where the profile goes.
async function refreshProvider(settings?: ClaudeSettings): Promise<ClaudeSettings> {
  const current = settings ?? await getClaudeSettings();
  ai = providerName(current);
  const button = byId<HTMLButtonElement>('review');
  button.textContent = `Review missed with ${ai}`;
  button.title = `Sends your whole profile to ${ai}, with the questions this tool could not answer`;
  return current;
}

// Runs for one question at a time because each click is a separate model call.
async function draft(row: PlanRow): Promise<void> {
  const settings = await refreshProvider();
  if (settings.mode === 'off') {
    setNotice('Turn on an AI connection under Profile and logs first.', true);
    return;
  }
  watchToken++;
  if (await dropAnswered([row])) {
    setNotice(`This field already has an answer on the page, so nothing went to ${ai}.`);
    return;
  }
  const question = questionFor(row);
  drafting = row;
  render();
  setNotice(`Asking ${ai} to draft a reply.`);
  log.info('claude.draft.start', { mode: settings.mode, provider: ai, model: activeModel(settings), label: row.label, kind: row.kind });
  try {
    const started = performance.now();
    const [profile, bank, tab] = await Promise.all([getProfile(), listAnswers(), chrome.tabs.get(tabId)]);
    const prompt = reviewPrompt(profile, bank, [question], new Date().toISOString().slice(0, 10), tab.title);
    const reply = await askClaude(settings, { system: DRAFT_SYSTEM, prompt, schema: REVIEW_SCHEMA });
    if (!rows.includes(row)) return;
    const [answer] = parseReview(reply, [question]);
    recordAnswer(row, answer, question.options, true);
    if (answer) await fillRows([row]);
    log.info('claude.draft.done', { label: row.label, drafted: Boolean(answer), applied: row.result?.ok ?? false, ms: Math.round(performance.now() - started) });
    setNotice(answer ? `${ai} drafted a reply and put it on the page. Check it below.` : `${ai} could not draft a reply from your profile.`);
  } finally {
    drafting = null;
  }
  void watchFilled(WATCH_MS).catch((error) => log.error('watch.failed', errorData(error)));
}

// Answers go onto the page right away and stay in the review group until the user decides.
async function review(): Promise<void> {
  const settings = await refreshProvider();
  if (settings.mode === 'off') {
    setNotice('Turn on an AI connection under Profile and logs first.', true);
    return;
  }
  watchToken++;
  const dropped = await dropAnswered(reviewTargets());
  const targets = reviewTargets();
  if (!targets.length) {
    setNotice(`The page already answered ${dropped} of those field(s), so there is nothing to send to ${ai}.`);
    return;
  }
  const questions = targets.map(questionFor);
  setNotice(`Asking ${ai} about ${questions.length} field(s).`);
  log.info('claude.review.start', { mode: settings.mode, provider: ai, model: activeModel(settings),questions: questions.length, labels: questions.map((question) => question.label) });

  const [profile, bank] = await Promise.all([getProfile(), listAnswers()]);
  const started = performance.now();
  const reply = await askClaude(settings, { system: REVIEW_SYSTEM, prompt: reviewPrompt(profile, bank, questions, new Date().toISOString().slice(0, 10)), schema: REVIEW_SCHEMA });
  if (targets.some((row) => !rows.includes(row))) {
    setNotice(`The page changed while ${ai} was answering, so nothing was applied. Scan and try again.`, true);
    return;
  }
  const answers = new Map(parseReview(reply, questions).map((answer) => [answer.id, answer]));

  const answered = targets.filter((row) => answers.has(questionId(row)));
  for (const row of targets) {
    recordAnswer(row, answers.get(questionId(row)), questions.find((question) => question.id === questionId(row))!.options);
  }
  const results = await fillRows(answered);
  log.info('claude.review.done', {
    questions: questions.length,
    answered: answered.length,
    applied: results.filter((result) => result.ok).length,
    failed: answered.filter((row) => row.result && !row.result.ok).map((row) => ({ label: row.label, kind: row.kind, detail: row.result!.detail })),
    ms: Math.round(performance.now() - started),
  });
  setNotice(answered.length
    ? `${ai} answered ${answered.length} of ${questions.length} field(s). Check each answer below.`
    : `${ai} found no answers in your profile for those ${questions.length} field(s).`);
  void watchFilled(WATCH_MS).catch((error) => log.error('watch.failed', errorData(error)));
}

async function resolveReview(row: PlanRow, save: boolean): Promise<void> {
  const claude = row.claude!;
  const answer = claude.edit.trim();
  if (!answer) {
    setNotice('Type an answer first.');
    return;
  }
  const changed = answer !== row.value;
  if (changed || !row.result?.ok) {
    row.value = answer;
    await fillSingle(row, 'ok');
  }
  if (save) {
    const normalized = normalize(row.label);
    await putAnswer({ id: normalized, question: row.label, normalized, answer, updatedAt: Date.now() });
  }
  log.info('claude.review.resolved', { label: row.label, saved: save, changed, answer, onPage: row.result?.ok ?? false });
  claude.state = 'done';
  row.status = 'ready';
  row.confirmed = true;
  row.reason = save ? 'Saved to your answer bank.' : 'Used for this application only.';
  if (!row.result?.ok) setNotice(`${save ? 'Saved, but this' : 'This'} answer could not go on the page. Enter it there yourself.`, true);
}

function renderReviewRow(row: PlanRow) {
  const claude = row.claude!;
  const edit = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    claude.edit = target instanceof HTMLSelectElement && target.multiple ? Array.from(target.selectedOptions, (option) => option.value).join(', ') : target.value;
  };
  const name = `Answer for ${row.label}`;
  let control: HTMLElement;
  if (claude.options.length) {
    const many = takesMany(row);
    const select = h('select', { 'aria-label': name, multiple: many, change: edit }, ...claude.options.map((option) => h('option', { value: option }, option)));
    if (many) {
      const on = savedChoices(claude.edit, claude.options);
      Array.from(select.options).forEach((option, index) => { option.selected = on.includes(index); });
    } else {
      select.value = claude.edit;
    }
    control = select;
  } else if (row.kind === 'textarea' || claude.edit.length > 60) {
    control = h('textarea', { 'aria-label': name, rows: '4', value: claude.edit, input: edit });
  } else {
    control = h('input', { 'aria-label': name, value: claude.edit, input: edit });
  }
  const failed = row.result && !row.result.ok;
  return h('div', { class: 'row', 'data-review': row.label },
    h('div', { class: 'row-head' },
      h('span', { class: 'row-label' }, row.required ? `${row.label} (required)` : row.label),
      h('span', { class: `tag ${failed ? 'bad' : 'warn'}` }, failed ? 'Not on page' : `${claude.confidence} confidence`)),
    h('div', { class: 'row-reason' }, claude.basis),
    failed ? h('div', { class: 'row-reason' }, `Could not fill: ${row.result!.detail}`) : null,
    h('div', {}, 'Is this correct? Change it here if not.'),
    control,
    h('div', { class: 'row-buttons' },
      h('button', { class: 'small primary', click: guard(() => resolveReview(row, true)) }, 'Save answer'),
      h('button', { class: 'small', click: guard(() => resolveReview(row, false)) }, 'Use without saving'),
      h('button', { class: 'small', click: guard(async () => { await send(row.frameId, { type: 'show', runId, fieldId: row.fieldId }); }) }, 'Show')));
}

async function fillSingle(row: PlanRow, mark: FillItem['mark']): Promise<void> {
  const item: FillItem = { fieldId: row.fieldId, key: row.key, kind: row.kind, value: row.value, overwrite: true, mark, place: row.place };
  const results = await send<FillResult[]>(row.frameId, { type: 'fill', runId, items: [item] });
  if (results?.[0]) row.result = results[0];
  log.info('row.fillSingle', { key: row.key, status: row.status, ok: results?.[0]?.ok });
}

async function saveAnswer(row: PlanRow): Promise<void> {
  const answer = await send<string>(row.frameId, { type: 'read', runId, fieldId: row.fieldId });
  if (!answer?.trim()) {
    setNotice('Type your answer into the field on the page first, then click Save.');
    return;
  }
  const normalized = normalize(row.label);
  await putAnswer({ id: normalized, question: row.label, normalized, answer, updatedAt: Date.now() });
  log.info('bank.saved', { label: row.label, answer });
  row.status = 'existing';
  row.value = answer;
  row.reason = 'Saved to your answer bank.';
}

function statusTag(row: PlanRow): { text: string; tone: string } {
  if (row.result) return row.result.ok ? { text: 'Filled', tone: 'good' } : { text: 'Failed', tone: 'bad' };
  const map: Record<string, [string, string]> = {
    ready: ['Ready', 'good'], low: ['Check', 'warn'], confirm: ['Confirm', 'warn'], existing: ['Has value', ''], missing: ['No data', 'bad'],
    'no-option': ['No choice fits', 'bad'], suggested: ['Saved answer', 'warn'], unmatched: ['Unrecognized', ''], blocked: ['Never filled', 'bad'],
  };
  const [text, tone] = map[row.status];
  return { text, tone };
}

function renderRow(row: PlanRow, rerender: () => void) {
  const tag = statusTag(row);
  const run = (action: () => Promise<void>) => guard(action);
  const buttons = h('div', { class: 'row-buttons' },
    h('button', { class: 'small', click: run(async () => { await send(row.frameId, { type: 'show', runId, fieldId: row.fieldId }); }) }, 'Show'));

  if (canDraft(row, fieldFor(row))) {
    buttons.prepend(h('button', { class: 'small primary', disabled: Boolean(drafting) || busy > 0, click: run(() => draft(row)) }, row === drafting ? 'Drafting...' : `Draft reply with ${ai}`));
  }
  if (row.status === 'existing' && row.value && row.key && !row.result && row.kind !== 'file') {
    buttons.append(h('button', { class: 'small', click: run(() => fillSingle(row, 'low')) }, 'Replace with mine'));
  }
  if (row.status === 'suggested' && !row.result) {
    buttons.append(h('button', { class: 'small', click: run(() => fillSingle(row, 'low')) }, 'Use saved answer'));
  }
  if ((row.status === 'unmatched' || row.status === 'suggested') && row.kind !== 'file') {
    buttons.append(h('button', { class: 'small', click: run(() => saveAnswer(row)) }, 'Save my answer'));
  }
  if (row.status === 'confirm' && row.result?.ok) {
    buttons.append(h('label', { class: 'confirm-line' },
      h('input', { type: 'checkbox', checked: row.confirmed, change: (event: Event) => { row.confirmed = (event.target as HTMLInputElement).checked; rerender(); } }),
      'Correct for this application'));
  }

  const entry = row.key ? CATALOG_BY_KEY.get(row.key) : undefined;
  const shownValue = row.result?.chosen ?? row.value;
  const detail = row.result && !row.result.ok ? `Could not fill: ${row.result.detail}` : row.result?.detail.includes('check') ? row.result.detail : row.reason;
  return h('div', { class: 'row' },
    h('div', { class: 'row-head' },
      h('span', { class: 'row-label' }, row.required ? `${row.label} (required)` : row.label),
      h('span', { class: `tag ${tag.tone}` }, tag.text)),
    entry && entry.label !== row.label ? h('div', { class: 'muted' }, `Treated as ${entry.label}${row.index ? ` #${row.index + 1}` : ''}, score ${row.score.toFixed(2)}`) : null,
    shownValue && row.status !== 'blocked' ? h('div', { class: 'row-value' }, shownValue) : null,
    detail ? h('div', { class: 'row-reason' }, detail) : null,
    buttons);
}

function render(): void {
  const report = byId('report');
  report.replaceChildren();
  if (!rows.length) return;

  const asking = (row: PlanRow) => row.claude?.state === 'asking';
  const needsYou = (row: PlanRow) => !asking(row) && ((row.result && !row.result.ok) || ['missing', 'no-option', 'blocked', 'unmatched', 'suggested'].includes(row.status));
  const pending = rows.filter(asking);
  const groups: [string, PlanRow[]][] = [
    ['Needs you', rows.filter(needsYou).sort((a, b) => Number(b.required) - Number(a.required))],
    ['Confirm these answers', rows.filter((row) => !needsYou(row) && !asking(row) && row.status === 'confirm')],
    ['Check these matches', rows.filter((row) => !needsYou(row) && row.status === 'low')],
    [rows.some((row) => row.result) ? 'Filled' : 'Ready to fill', rows.filter((row) => !needsYou(row) && row.status === 'ready')],
    ['Left alone', rows.filter((row) => !needsYou(row) && row.status === 'existing')],
  ];

  const filled = rows.filter((row) => row.result?.ok).length;
  const unconfirmed = rows.filter((row) => row.status === 'confirm' && !asking(row) && row.result?.ok && !row.confirmed).length;
  const required = rows.filter((row) => row.required && needsYou(row)).length;
  report.append(h('p', { class: 'summary' },
    `${rows.length} fields found${filled ? `, ${filled} filled` : ''}. ${required} required field(s) need you.${unconfirmed ? ` ${unconfirmed} answer(s) still need confirming.` : ''}${pending.length ? ` ${pending.length} ${ai} answer(s) to check.` : ''}`));

  if (pending.length) {
    report.append(h('section', { class: 'card', 'data-group': 'Claude' },
      h('h2', {}, `${ai}'s answers, check these (${pending.length})`),
      ...pending.map(renderReviewRow)));
  }

  for (const [title, members] of groups) {
    if (!members.length) continue;
    report.append(h('section', { class: 'card', 'data-group': title },
      h('h2', {}, `${title} (${members.length})`),
      ...members.map((row) => renderRow(row, render))));
  }
}

// Resumes can be added on the options page while this panel stays open.
async function loadResumes(): Promise<void> {
  const select = byId<HTMLSelectElement>('resume');
  resumes = await listResumes();
  // Read after the wait, or a resume picked during it gets switched back.
  const current = select.value;
  select.replaceChildren(...resumes.map((resume) => h('option', { value: resume.id }, resume.name)));
  const preferred = resumes.find((resume) => resume.id === current) ?? resumes.find((resume) => resume.isDefault);
  if (preferred) select.value = preferred.id;
  if (!resumes.length) select.append(h('option', { value: '' }, 'No resume added yet'));
}

async function init(): Promise<void> {
  await loadResumes();

  const profile = await getProfile();
  if (!profile.updatedAt) setNotice('No profile yet. Open Profile and logs to add your resume.');
  else log.debug('profile.gaps', { gaps: profileGaps(profile).map((gap) => gap.key) });

  byId('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  byId('bug').addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#bug') }));
  byId('scan').addEventListener('click', guard(scan));
  byId('fill').addEventListener('click', guard(fill));
  byId('undo').addEventListener('click', guard(undo));
  byId('review').addEventListener('click', guard(review));
  // The provider can change on the options page while the panel stays open.
  const showProvider = () => refreshProvider().then(render).catch((error) => log.error('provider.refresh', errorData(error)));
  window.addEventListener('focus', showProvider);
  document.addEventListener('visibilitychange', showProvider);
  await refreshProvider();
  chrome.tabs.onActivated.addListener(() => {
    if (new URLSearchParams(location.search).has('tabId')) return;
    rows = [];
    render();
    byId<HTMLButtonElement>('review').disabled = true;
    byId<HTMLButtonElement>('fill').disabled = true;
    byId<HTMLButtonElement>('undo').disabled = true;
  });
}

void init();
