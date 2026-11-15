// Writes values into page controls. Each strategy works by widget behavior, so a
// new site needs no code unless it uses a control type not handled here.
import { CATALOG_BY_KEY } from '../engine/catalog';
import { chooseAddress, chooseOption, chooseSkill, PLACEHOLDER_OPTION, savedChoices, searchQueries, skillQueries, splitSkills } from '../engine/options';
import { createLogger, errorData } from '../shared/log';
import type { AddressPlace, FilePayload, FillItem, FillResult } from '../shared/types';
import { chipElements, chipText, chosenChips, clean, comboboxHasValue, handles, isVisible, isWorkdayPicker, workdayDateDisplay, workdayDateShown, workdayLabel, workdayPicked, workdayPills, optionLabel, sectionOf, selectHasValue, shownValue, type Handle } from './scan';

let currentRun: string | undefined;
const log = createLogger('fill', () => currentRun);
export const setRun = (runId: string) => (currentRun = runId);

const COLORS = { ok: '#1a9c5b', low: '#d98a00', confirm: '#d98a00' };
const undoStack: { fieldId: string; undo: (() => void | Promise<void>) | null }[] = [];
const highlighted = new Map<HTMLElement, string>();
// Lives in the page, so a reload forgets it and a form that rebuilds its file input does not.
let sentFile: { id: string; name: string; href: string; input?: HTMLInputElement; shown: boolean } | null = null;
// iCIMS and similar forms post the resume to their server as soon as it is attached and come back as a new page.
let leaving = false;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

// Fill runs while the side panel has focus. Chrome then moves the active element on focus() and blur()
// but fires no focus events, and Workday only keeps a typed value when the field fires blur.
function focusField(el: HTMLElement): void {
  el.focus();
  if (document.hasFocus()) return;
  el.dispatchEvent(new FocusEvent('focus', { composed: true }));
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
}

function blurField(el: HTMLElement): void {
  el.blur();
  if (document.hasFocus()) return;
  el.dispatchEvent(new FocusEvent('blur', { composed: true }));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
}

// Workday swaps in a new element when a field loses focus, with the same id and the value it kept.
// A handle to the old element would then look like a cleared field and hide the Add Another button.
function liveHandle(fieldId: string): Handle | undefined {
  const handle = handles.get(fieldId);
  if (!handle || handle.el.isConnected || !handle.el.id) return handle;
  const found = document.getElementById(handle.el.id);
  if (!found || found.tagName !== handle.el.tagName) return handle;
  const fresh = { ...handle, el: found };
  handles.set(fieldId, fresh);
  return fresh;
}

// Bypasses framework wrappers on the element so React and others see a real change.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
}

function pressSequence(el: Element): void {
  // A real mouse click has detail 1. Some widgets ignore detail 0 as a keyboard or scripted click.
  const init = { bubbles: true, composed: true, cancelable: true, view: window, button: 0, detail: 1 };
  el.dispatchEvent(new PointerEvent('pointerdown', init));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new PointerEvent('pointerup', init));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  el.dispatchEvent(new MouseEvent('click', init));
}

function pressEscape(el: Element): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, composed: true }));
}

function visibleTarget(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node && node.getBoundingClientRect().width < 8 && node.parentElement) node = node.parentElement;
  return node ?? el;
}

function highlight(el: HTMLElement, mark: keyof typeof COLORS): void {
  const target = visibleTarget(el);
  if (!highlighted.has(target)) highlighted.set(target, target.style.outline);
  target.style.outline = `2px solid ${COLORS[mark]}`;
}

function clearHighlights(): void {
  for (const [target, outline] of highlighted) target.style.outline = outline;
  highlighted.clear();
}

function fillText(el: HTMLInputElement | HTMLTextAreaElement, value: string): { ok: boolean; detail: string; undo: () => void } {
  const previous = el.value;
  const write = (next: string) => {
    focusField(el);
    setNativeValue(el, next);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: next }));
    fire(el, 'change');
    blurField(el);
  };
  write(value);
  const undo = () => write(previous);
  if (el.value === value) return { ok: true, detail: 'set', undo };
  // Punctuation and case can change. Letters and digits can't, or a truncated name would pass.
  const content = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (content(el.value) && content(el.value) === content(value)) return { ok: true, detail: 'page reformatted the value', undo };
  return { ok: false, detail: el.value ? 'page changed the value after it was set' : 'page cleared the value', undo };
}

// Workday's date boxes take one keystroke at a time. Each digit moves into a display beside the input, the
// input empties, and a full month moves focus on to the year. A whole value set at once is ignored.
async function typeDigits(el: HTMLInputElement, digits: string): Promise<void> {
  focusField(el);
  for (const ch of digits) {
    const init = { key: ch, code: /\d/.test(ch) ? `Digit${ch}` : '', bubbles: true, composed: true, cancelable: true };
    if (el.dispatchEvent(new KeyboardEvent('keydown', init))) {
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      setNativeValue(el, el.value + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ch }));
    }
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    await delay(20);
  }
  // A full month has already moved focus on to the year, and blurring then would take it back off.
  if (document.activeElement === el) blurField(el);
}

async function fillWorkdayDate(fieldId: string, el: HTMLInputElement, value: string): Promise<{ ok: boolean; detail: string; undo: () => void | Promise<void> }> {
  const previous = workdayDateShown(el) ?? '';
  await typeDigits(el, value);
  await delay(100);
  const now = liveHandle(fieldId)?.el ?? el;
  const shown = workdayDateShown(now) ?? '';
  const undo = async () => { if (previous) await typeDigits(liveHandle(fieldId)?.el as HTMLInputElement ?? el, previous); };
  if (shown && Number(shown) === Number(value)) return { ok: true, detail: 'typed', undo };
  return { ok: false, detail: shown ? `page shows ${shown.length} other digits` : 'page did not take the typed digits', undo };
}

function pressKey(el: Element, key: string, keyCode: number): void {
  const init = { key, code: key, keyCode, which: keyCode, bubbles: true, composed: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keypress', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
}

// Case, spacing and . - _ / can differ between the resume and a pill.
const skillKey = (text: string) => text.toLowerCase().replace(/[\s.\-_/]+/g, '');

// The search results. Workday draws the picked skills the same way, and not always inside a
// selectedItem, so once any row has a checkbox only rows with one count. Pills have none.
function workdayResults(): HTMLElement[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id=menuItem]'));
  const found = (rows.length ? rows : Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id=promptOption],[role=option]')))
    .filter((row) => !row.closest('[data-automation-id=selectedItem]') && row.getBoundingClientRect().height > 0);
  const boxed = found.filter((row) => row.querySelector('input[type=checkbox],[data-automation-id=checkboxPanel]'));
  return boxed.length ? boxed : found.filter((row) => !workdayPickedLabels().has(workdayLabel(row)));
}

const workdayPickedLabels = () => new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id=selectedItem]'), workdayLabel));

// Workday sets aria-selected on the result the keyboard highlights, which after a search is the first
// one, so aria-selected says nothing about a row that has its own checkbox.
function resultTicked(row: HTMLElement): boolean {
  const mark = row.querySelector('[data-automation-checked]')?.getAttribute('data-automation-checked');
  if (mark) return mark === 'Checked';
  const box = row.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (box) return box.checked || box.getAttribute('aria-checked') === 'true';
  return row.getAttribute('aria-checked') === 'true' || row.getAttribute('aria-selected') === 'true';
}

const resultLabels = () => workdayResults().map(workdayLabel).join('\n');

// Workday empties its results while a search loads and draws the new ones up to a second or more later.
// Reading the empty list, or the last search's, gave one skill the results meant for the one before.
// The results count once they are not empty, differ from the last search's, and hold still.
async function searchWorkday(input: HTMLInputElement, query: string): Promise<HTMLElement[]> {
  const old = resultLabels();
  focusField(input);
  setNativeValue(input, query);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: query }));
  await delay(150);
  pressKey(input, 'Enter', 13);
  const started = Date.now();
  let last = '';
  let steady = 0;
  while (Date.now() - started < 8000) {
    await delay(150);
    const now = resultLabels();
    steady = now === last ? steady + 1 : 0;
    last = now;
    const waited = Date.now() - started;
    // The same results as the last search can be right, and so can none at all, but only after a wait.
    const fresh = now && now !== old;
    if (fresh && steady >= 2) break;
    if (now && waited > 3500 && steady >= 3) break;
    if (!now && waited > 4000) break;
  }
  return workdayResults();
}

async function clearWorkdaySearch(input: HTMLInputElement): Promise<void> {
  if (!input.value) return;
  setNativeValue(input, '');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
  await delay(100);
}

const pillFor = (input: HTMLInputElement, label: string) => workdayPicked(input).some((pill) => skillKey(pill) === skillKey(label));

// Ticks one result. A result that is already ticked stays as it is, since a second click would untick it.
async function tickResult(row: HTMLElement, input: () => HTMLInputElement): Promise<boolean> {
  const label = workdayLabel(row);
  if (resultTicked(row) || pillFor(input(), label)) return true;
  const targets = [row.querySelector<HTMLElement>('input[data-automation-id=checkboxPanel],input[type=checkbox]'), row.querySelector<HTMLElement>('[data-automation-id=promptLeafNode]'), row];
  for (const target of targets) {
    if (!target) continue;
    target.scrollIntoView({ block: 'nearest' });
    pressSequence(target);
    await delay(250);
    if (pillFor(input(), label) || (row.isConnected && resultTicked(row))) return true;
  }
  return pillFor(input(), label);
}

// Workday's Skills box takes one skill per search and ignores a typed list. Ticking the result's
// checkbox adds it, and clicking the row does nothing. Each skill tries shorter searches until one
// offers a close fit.
async function fillWorkdayPicker(fieldId: string, el: HTMLInputElement, value: string): Promise<{ ok: boolean; detail: string; chosen?: string; undo: () => Promise<void> }> {
  const current = () => (liveHandle(fieldId)?.el ?? el) as HTMLInputElement;
  const before = workdayPicked(el);
  const wanted = splitSkills(value);
  const chosen = new Map<string, string>();
  const offeredFor = new Map<string, string[]>();
  el.scrollIntoView({ block: 'center' });
  const addSkill = async (skill: string) => {
    const offered = offeredFor.get(skill) ?? [];
    offeredFor.set(skill, offered);
    for (const query of skillQueries(skill)) {
      const rows = await searchWorkday(current(), query);
      const labels = rows.map(workdayLabel);
      offered.push(...labels.slice(0, 8));
      const index = chooseSkill(skill, labels);
      if (index >= 0 && (await tickResult(rows[index], current))) {
        chosen.set(skill, labels[index]);
        log.info('workday.skillAdded', { skill, query, chosen: labels[index], pill: pillFor(current(), labels[index]) });
        break;
      }
    }
    await clearWorkdaySearch(current());
  };
  const hasPill = (skill: string) => {
    const label = chosen.get(skill);
    return Boolean(label && pillFor(current(), label));
  };
  for (const skill of wanted) {
    const have = workdayPicked(current()).find((label) => skillKey(label) === skillKey(skill));
    if (have) chosen.set(skill, have);
    else await addSkill(skill);
  }
  // The report comes from the pills on the page, not from what the clicks were meant to do. A skill
  // that was chosen but has no pill gets one more try.
  await delay(300);
  for (const skill of wanted.filter((skill) => chosen.has(skill) && !hasPill(skill))) {
    log.info('workday.skillNoPill', { skill, chosen: chosen.get(skill) });
    chosen.delete(skill);
    await addSkill(skill);
  }
  const input = current();
  pressEscape(input);
  blurField(input);
  await delay(300);
  const picked = [...new Set(wanted.filter(hasPill).map((skill) => chosen.get(skill) as string))];
  const missing = wanted.filter((skill) => !hasPill(skill));
  for (const skill of missing) {
    log.info('workday.skillMissed', { skill, chosen: chosen.get(skill) ?? '', offered: [...new Set(offeredFor.get(skill) ?? [])].slice(0, 12) });
  }
  log.debug('workday.picker', { wanted: wanted.length, picked: picked.length, missing: missing.length });

  const undo = async () => {
    const keep = new Set(before.map(skillKey));
    for (let attempt = 0; attempt < 100; attempt++) {
      const pill = workdayPills(current()).find((candidate) => !keep.has(skillKey(workdayLabel(candidate))));
      const remove = pill?.querySelector<HTMLElement>('[data-automation-id*=delete i],[aria-label*=remove i],[aria-label*=delete i],button,[role=button]');
      if (!remove) break;
      pressSequence(remove);
      await delay(150);
    }
  };
  const unkept = missing.filter((skill) => chosen.has(skill));
  const absent = missing.filter((skill) => !chosen.has(skill));
  const notes = [
    absent.length ? `Workday offered nothing close to ${absent.join(', ')}` : '',
    unkept.length ? `Workday did not keep ${unkept.map((skill) => `${skill} as ${chosen.get(skill)}`).join(', ')}` : '',
  ].filter(Boolean);
  if (!picked.length) return { ok: false, detail: `added none of the ${wanted.length} skills; ${notes.join('; ')}`, undo };
  const detail = `added ${picked.length} of ${wanted.length} skills${notes.length ? `; check the rest, ${notes.join('; ')}` : ''}`;
  return { ok: true, detail, chosen: picked.join(', '), undo };
}

function fillContentEditable(el: HTMLElement, value: string): { ok: boolean; detail: string; undo: () => void } {
  const previous = el.innerHTML;
  focusField(el);
  document.getSelection()?.selectAllChildren(el);
  const inserted = document.execCommand('insertText', false, value);
  if (!inserted || !el.textContent?.includes(value.slice(0, 20))) {
    el.textContent = value;
    fire(el, 'input');
  }
  fire(el, 'change');
  blurField(el);
  return { ok: Boolean(el.textContent?.trim()), detail: inserted ? 'insertText' : 'textContent', undo: () => { el.innerHTML = previous; fire(el, 'input'); } };
}

function pickIndexes(key: string, value: string, labels: string[], many: boolean): { indexes: number[]; detail: string } | null {
  const several = many ? savedChoices(value, labels) : [];
  if (several.length) return { indexes: several, detail: `${several.length} of the saved choices` };
  const choice = chooseOption(key, value, labels);
  return choice && { indexes: [choice.index], detail: `option score ${choice.score}` };
}

function fillSelect(el: HTMLSelectElement, key: string, value: string): { ok: boolean; detail: string; chosen?: string; undo?: () => void } {
  const labels = Array.from(el.options).map((option) => clean(option.textContent));
  const picked = pickIndexes(key, value, labels, el.multiple);
  if (!picked) {
    log.warn('select.noOption', { key, options: labels });
    return { ok: false, detail: 'no option fits' };
  }
  const previous = Array.from(el.selectedOptions, (option) => option.index);
  const write = (indexes: number[]) => {
    focusField(el);
    if (el.multiple) Array.from(el.options).forEach((option, index) => { option.selected = indexes.includes(index); });
    else el.selectedIndex = indexes[0] ?? -1;
    fire(el, 'input');
    fire(el, 'change');
    blurField(el);
  };
  write(picked.indexes);
  return { ok: picked.indexes.every((index) => el.options[index].selected), detail: picked.detail, chosen: picked.indexes.map((index) => labels[index]).join(', '), undo: () => write(previous) };
}

function isChecked(el: HTMLElement): boolean {
  return (el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true';
}

function pressChoice(el: HTMLElement): void {
  if (el.tagName === 'INPUT') el.click();
  else pressSequence(el);
}

function restoreGroup(members: HTMLElement[], before: boolean[]): void {
  // The earlier choice goes back first, so a radio group clears the new one by itself.
  members.forEach((el, index) => {
    if (before[index] && !isChecked(el)) pressChoice(el);
  });
  members.forEach((el, index) => {
    if (before[index] || !isChecked(el)) return;
    // Clicking a checked radio does nothing, so a group that started empty has to be cleared directly.
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      el.checked = false;
      fire(el, 'change');
      return;
    }
    pressChoice(el);
    if (isChecked(el) && el.getAttribute('role') === 'radio') {
      el.setAttribute('aria-checked', 'false');
      fire(el, 'change');
    }
  });
  if (members.some((el, index) => isChecked(el) !== before[index])) throw new Error('group did not return to its earlier state');
}

function fillGroup(handle: Handle, key: string, value: string): { ok: boolean; detail: string; chosen?: string; undo?: () => void } {
  const labels = handle.optionEls.map(optionLabel);
  const picked = pickIndexes(key, value, labels, handle.kind === 'checkbox');
  if (!picked) {
    log.warn('group.noOption', { key, options: labels });
    return { ok: false, detail: 'no option fits' };
  }
  const targets = picked.indexes.map((index) => handle.optionEls[index]);
  const before = handle.optionEls.map(isChecked);
  for (const target of targets) {
    if (!isChecked(target)) pressChoice(target);
  }
  // A group with ticked boxes only gets this far through an explicit replace, which means this answer instead of those.
  for (const el of handle.optionEls) {
    if (!targets.includes(el) && isChecked(el) && el.matches('input[type=checkbox],[role=checkbox]')) pressChoice(el);
  }
  return { ok: targets.every(isChecked), detail: picked.detail, chosen: picked.indexes.map((index) => labels[index]).join(', '), undo: () => restoreGroup(handle.optionEls, before) };
}

function listOptions(el: HTMLElement): HTMLElement[] {
  const root = el.getRootNode() as Document | ShadowRoot;
  const opensMenu = el.matches('[aria-haspopup]:not([aria-haspopup=listbox])');
  const selector = `[role=option],[data-automation-id=promptOption]${opensMenu ? ',[role=menuitem]' : ''}`;
  const owned = [el.getAttribute('aria-controls'), el.getAttribute('aria-owns'), el.getAttribute('data-menu-id'), el.querySelector('input')?.getAttribute('aria-controls')]
    .filter((id): id is string => Boolean(id))
    .map((id) => root.getElementById(id))
    .find(Boolean);
  const found = Array.from((owned ?? root).querySelectorAll<HTMLElement>(selector));
  const list = found.length || root === document ? found : Array.from(document.querySelectorAll<HTMLElement>(selector));
  return list.filter((option) => option.getBoundingClientRect().height > 0 && !/^(no (results|options)|loading)/i.test(clean(option.textContent)));
}

async function waitForOptions(el: HTMLElement, timeout: number): Promise<HTMLElement[]> {
  const deadline = Date.now() + timeout;
  let options = listOptions(el);
  while (!options.length && Date.now() < deadline) {
    await delay(50);
    options = listOptions(el);
  }
  return options;
}

const CHIP_REMOVE = 'button,[role=button],[aria-label*=remove i],[class*=remove i],[class*=close i],[class*=clear i]';
const optionIsOn = (option: HTMLElement) => option.getAttribute('aria-selected') === 'true' || option.getAttribute('aria-checked') === 'true';

// Many of these lists close or rebuild after each pick, so the options are read fresh every time.
async function currentOptions(el: HTMLElement): Promise<HTMLElement[]> {
  const open = listOptions(el);
  if (open.length) return open;
  pressSequence(el);
  return waitForOptions(el, 700);
}

async function pickMany(el: HTMLElement, input: HTMLInputElement | null, key: string, value: string, first: HTMLElement[]): Promise<{ ok: boolean; detail: string; chosen: string } | null> {
  const labels = [...first.map((option) => clean(option.textContent)), ...chosenChips(el)];
  const found = savedChoices(value, labels).map((index) => labels[index]);
  const whole = found.length === 1 && found[0].toLowerCase() === value.trim().toLowerCase();
  const wanted = found.length > 1 || whole || (found.length && !input) ? found : value.split(/\s*,\s*/).filter(Boolean);
  const find = (options: HTMLElement[], label: string) => {
    const choice = chooseOption(key, label, options.map((option) => clean(option.textContent)));
    return choice && choice.score >= 0.85 ? options[choice.index] : undefined;
  };

  const picked: string[] = [];
  for (const label of wanted) {
    // Some lists drop a picked item from the menu, so the chip is the only sign it's on.
    const already = chosenChips(el).find((chip) => chip.toLowerCase() === label.toLowerCase());
    if (already) {
      picked.push(already);
      continue;
    }
    let match = find(await currentOptions(el), label);
    if (!match && input) {
      setNativeValue(input, label);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: label }));
      await delay(250);
      match = find(await waitForOptions(el, 1500), label);
    }
    if (match) {
      picked.push(clean(match.textContent));
      if (!optionIsOn(match)) {
        match.scrollIntoView({ block: 'nearest' });
        pressSequence(match);
        await delay(100);
      }
    }
    if (input?.value) {
      setNativeValue(input, '');
      fire(input, 'input');
      await delay(50);
    }
  }
  if (!picked.length) return null;

  // This only runs on an empty field or an explicit replace, so other ticked options come off.
  for (let attempt = 0; attempt < 20; attempt++) {
    const stray = (await currentOptions(el)).find((option) => optionIsOn(option) && !picked.includes(clean(option.textContent)));
    if (!stray) break;
    pressSequence(stray);
    await delay(100);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const remove = chipElements(el).find((chip) => !picked.includes(chipText(chip)))?.querySelector<HTMLElement>(CHIP_REMOVE);
    if (!remove) break;
    pressSequence(remove);
    await delay(100);
  }
  pressEscape(el);
  document.body.click();
  const left = chosenChips(el).filter((chip) => !picked.includes(chip)).length;
  log.debug('combobox.many', { key, wanted: wanted.length, picked: picked.length, left });
  return { ok: true, detail: `${picked.length} of ${wanted.length} choices${left ? `, ${left} earlier choices could not be removed` : ''}`, chosen: picked.join(', ') };
}

interface ComboBefore { text: string; chips: string[]; on: string[] }

// Puts a list that takes several choices back to the choices it held before the fill.
async function undoMany(el: HTMLElement, before: ComboBefore): Promise<void> {
  const want = new Set([...before.chips, ...before.on]);
  const usesChips = before.chips.length > 0 || chosenChips(el).length > 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const strayChip = chipElements(el).find((chip) => !want.has(chipText(chip)));
    const remove = strayChip?.querySelector<HTMLElement>(CHIP_REMOVE);
    if (remove) {
      pressSequence(remove);
      await delay(100);
      continue;
    }
    if (!strayChip && usesChips) break;
    const stray = (await currentOptions(el)).find((option) => optionIsOn(option) && !want.has(clean(option.textContent)));
    if (!stray) break;
    pressSequence(stray);
    await delay(100);
  }
  for (const label of want) {
    if (chosenChips(el).includes(label)) continue;
    const option = (await currentOptions(el)).find((candidate) => clean(candidate.textContent) === label);
    if (option && !optionIsOn(option)) {
      pressSequence(option);
      await delay(100);
    }
  }
  pressEscape(el);
  document.body.click();
  if (!usesChips) return;
  const now = chosenChips(el).sort().join('\n');
  if (now !== [...before.chips].sort().join('\n')) throw new Error('the list did not return to its earlier choices');
}

async function undoCombobox(handle: Handle, input: HTMLInputElement | null, before: ComboBefore): Promise<void> {
  const { el } = handle;
  if (handle.multi) return undoMany(el, before);
  if (input) {
    if (input.value === before.text) {
      if (before.text) return;
      throw new Error('the page shows the choice outside its input, so it cannot be cleared');
    }
    focusField(input);
    setNativeValue(input, before.text);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: before.text }));
    fire(input, 'change');
    pressEscape(input);
    blurField(input);
    await delay(50);
    if (input.value !== before.text) throw new Error('the page kept the filled value');
    return;
  }
  const shown = () => clean(el.textContent);
  if (shown() === before.text) return;
  const earlier = (await currentOptions(el)).find((option) => clean(option.textContent) === before.text);
  if (earlier) {
    pressSequence(earlier);
    await delay(100);
  }
  pressEscape(el);
  document.body.click();
  if (shown() !== before.text) throw new Error('the list has no option for its earlier state');
}

async function fillCombobox(handle: Handle, key: string, value: string, place?: AddressPlace): Promise<{ ok: boolean; detail: string; chosen?: string; undo?: () => Promise<void> }> {
  const { el } = handle;
  const input = el.matches('input') ? (el as HTMLInputElement) : el.querySelector('input');
  const before: ComboBefore = { text: input ? input.value : clean(el.textContent), chips: chosenChips(el), on: [] };
  const undo = () => undoCombobox(handle, input, before);
  el.scrollIntoView({ block: 'center' });
  pressSequence(el);
  focusField(el);

  const pick = async (options: HTMLElement[], how: string) => {
    const labels = options.map((option) => clean(option.textContent));
    const choice = key === 'addressLine1' ? chooseAddress(value, labels, place) : chooseOption(key, value, labels);
    log.debug('combobox.options', { key, how, count: labels.length, suggestions: labels.slice(0, 40), matched: choice?.index ?? null });
    if (!choice) return null;
    options[choice.index].scrollIntoView({ block: 'nearest' });
    pressSequence(options[choice.index]);
    await delay(100);
    return { ok: true, detail: `${how}, option score ${choice.score}`, chosen: labels[choice.index] };
  };

  let options = await waitForOptions(el, 700);
  // Some lists only show aria-multiselectable once they are open.
  if (options[0]?.closest('[aria-multiselectable=true]')) handle.multi = true;
  before.on = options.filter(optionIsOn).map((option) => clean(option.textContent));
  if (handle.multi && !place) {
    const many = await pickMany(el, input, key, value, options);
    if (many) return { ...many, undo };
  }
  if (options.length) {
    const picked = await pick(options, 'opened list');
    if (picked) return { ...picked, undo };
  }

  if (input) {
    const queries = key === 'addressLine1' ? [value] : searchQueries(value);
    for (const [attempt, query] of queries.entries()) {
      setNativeValue(input, query);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: query }));
      // A later search needs longer, or the previous search's options get read again.
      await delay(attempt ? 600 : 250);
      options = await waitForOptions(el, 1500);
      const picked = options.length ? await pick(options, attempt ? 'shorter typed search' : 'typed search') : null;
      if (picked) return { ...picked, undo };
    }

    const entry = CATALOG_BY_KEY.get(key);
    if (entry?.kinds.includes('text') && !entry.choices) {
      setNativeValue(input, value);
      fire(input, 'input');
      pressEscape(input);
      fire(input, 'change');
      // List-only widgets clear unmatched text on blur, so only trust what survives it.
      blurField(input);
      await delay(100);
      if (input.value) return { ok: true, detail: 'kept typed text; no list option fit', undo };
      log.warn('combobox.typedTextCleared', { key, optionCount: options.length, suggestions: options.slice(0, 40).map((option) => clean(option.textContent)) });
      return { ok: false, detail: 'this list only accepts its own options and none fit' };
    }
    setNativeValue(input, '');
    fire(input, 'input');
  }
  pressEscape(el);
  document.body.click();
  log.warn('combobox.noOption', { key, optionCount: options.length, suggestions: options.slice(0, 40).map((option) => clean(option.textContent)) });
  return { ok: false, detail: options.length ? 'no option fits' : 'no option list appeared' };
}

// Uses the scan's own tests, so a field the scan saw as empty still counts as empty here.
function holdsValue({ el, kind, optionEls }: Handle): boolean {
  if (kind === 'radio' || kind === 'checkbox') return optionEls.some(isChecked);
  if (kind === 'select') return selectHasValue(el as HTMLSelectElement);
  if (kind === 'combobox') return comboboxHasValue(el);
  if (kind === 'contenteditable') return Boolean(el.textContent?.trim());
  if (isWorkdayPicker(el) && workdayPicked(el).length) return true;
  const shownDate = workdayDateShown(el);
  if (shownDate !== null) return Boolean(shownDate);
  return Boolean((el as HTMLInputElement).value?.trim());
}

async function fillOne(item: FillItem): Promise<FillResult> {
  const handle = liveHandle(item.fieldId);
  if (!handle || !handle.el.isConnected) return { fieldId: item.fieldId, ok: false, detail: 'field is gone from the page' };
  if (!item.overwrite && holdsValue(handle)) return { fieldId: item.fieldId, ok: false, detail: 'the field has a value now, so it was left alone' };
  const { el, kind } = handle;
  let outcome: { ok: boolean; detail: string; chosen?: string; undo?: () => void | Promise<void> };
  switch (kind) {
    case 'text':
    case 'textarea':
    case 'date':
      if (isWorkdayPicker(el)) outcome = await fillWorkdayPicker(item.fieldId, el, item.value);
      else outcome = workdayDateDisplay(el) ? await fillWorkdayDate(item.fieldId, el as HTMLInputElement, item.value) : fillText(el as HTMLInputElement, item.value);
      break;
    case 'contenteditable':
      outcome = fillContentEditable(el, item.value);
      break;
    case 'select':
      outcome = fillSelect(el as HTMLSelectElement, item.key, item.value);
      break;
    case 'radio':
    case 'checkbox':
      outcome = fillGroup(handle, item.key, item.value);
      break;
    case 'combobox':
      outcome = await fillCombobox(handle, item.key, item.value, item.place);
      break;
    default:
      return { fieldId: item.fieldId, ok: false, detail: `cannot fill kind ${kind}` };
  }
  if (outcome.ok) {
    highlight(el, item.mark);
    undoStack.push({ fieldId: item.fieldId, undo: outcome.undo ?? null });
  }
  return { fieldId: item.fieldId, ok: outcome.ok, detail: outcome.detail, chosen: outcome.chosen };
}

export async function fillItems(items: FillItem[]): Promise<FillResult[]> {
  const results: FillResult[] = [];
  for (const item of items) {
    const started = performance.now();
    let result: FillResult;
    try {
      result = await fillOne(item);
    } catch (error) {
      log.error('field.exception', { fieldId: item.fieldId, key: item.key, ...errorData(error) });
      result = { fieldId: item.fieldId, ok: false, detail: `exception: ${(error as Error).message}` };
    }
    log[result.ok ? 'info' : 'warn']('field.result', {
      fieldId: item.fieldId, key: item.key, kind: item.kind, ok: result.ok, detail: result.detail, chosen: result.chosen, value: item.value, ms: Math.round(performance.now() - started),
    });
    results.push(result);
  }
  return results;
}

export function uploadFile(fieldId: string, payload: FilePayload, mark: 'ok' | 'low'): FillResult {
  const handle = liveHandle(fieldId);
  if (!handle || !handle.el.isConnected) return { fieldId, ok: false, detail: 'field is gone from the page' };
  const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0));
  const file = new File([bytes], payload.name, { type: payload.type, lastModified: Date.now() });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  leaving = false;
  addEventListener('beforeunload', () => (leaving = true), { once: true });

  if (handle.dropzone) {
    for (const type of ['dragenter', 'dragover', 'drop']) {
      handle.el.dispatchEvent(new DragEvent(type, { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer }));
    }
    highlight(handle.el, 'low');
    undoStack.push({ fieldId, undo: null });
    sentFile = { id: payload.id, name: payload.name, href: location.href, shown: false };
    log.info('upload.dropzone', { fieldId, size: file.size });
    return { fieldId, ok: true, detail: 'dropped on upload area; check that the page shows the file' };
  }

  const input = handle.el as HTMLInputElement;
  const extension = `.${payload.name.split('.').pop()!.toLowerCase()}`;
  const accept = input.accept.toLowerCase();
  if (accept && !accept.includes(extension) && !accept.includes(payload.type) && !accept.includes('*')) {
    log.warn('upload.acceptMismatch', { accept, extension, mime: payload.type });
  }
  input.files = transfer.files;
  fire(input, 'input');
  fire(input, 'change');
  const ok = input.files?.length === 1;
  if (ok) {
    highlight(input, mark);
    sentFile = { id: payload.id, name: payload.name, href: location.href, input, shown: false };
    undoStack.push({ fieldId, undo: () => { input.value = ''; sentFile = null; fire(input, 'change'); } });
  }
  log[ok ? 'info' : 'warn']('upload.input', { fieldId, ok, size: file.size, accept, multiple: input.multiple });
  return { fieldId, ok, detail: ok ? 'attached to file input' : 'page rejected the file' };
}

function pageShowsSentFile(): boolean {
  if (!sentFile || !document.body.innerText.includes(sentFile.name)) return false;
  sentFile.shown = true;
  return true;
}

// Parsing forms often rebuild the input, so an empty new input alone doesn't mean the file was removed.
export function sentFileId(): string {
  if (!sentFile || sentFile.href !== location.href) return '';
  const { id, input, shown } = sentFile;
  if (pageShowsSentFile() || (input?.isConnected && input.files?.length)) return id;
  const removed = input?.isConnected || shown;
  if (removed) sentFile = null;
  return removed ? '' : id;
}

// Waits for the page to stop changing, so forms that parse an upload can finish first.
export function waitForSettle(quietMs = 600, maxMs = 6000): Promise<{ waited: number; timedOut: boolean; leaving: boolean }> {
  const started = Date.now();
  return new Promise((resolve) => {
    let quietTimer = 0;
    const finish = (timedOut: boolean) => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      pageShowsSentFile();
      resolve({ waited: Date.now() - started, timedOut, leaving });
    };
    const arm = () => {
      clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => finish(false), quietMs);
    };
    const observer = new MutationObserver(arm);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const maxTimer = window.setTimeout(() => finish(true), maxMs);
    arm();
  });
}

export async function undoAll(): Promise<{ undone: number; notUndone: string[] }> {
  let undone = 0;
  const notUndone: string[] = [];
  while (undoStack.length) {
    const entry = undoStack.pop()!;
    if (!entry.undo) {
      notUndone.push(entry.fieldId);
      continue;
    }
    try {
      await entry.undo();
      undone++;
    } catch (error) {
      log.error('undo.exception', { fieldId: entry.fieldId, ...errorData(error) });
      notUndone.push(entry.fieldId);
    }
  }
  clearHighlights();
  return { undone, notUndone };
}

export function readField(fieldId: string): string {
  const handle = liveHandle(fieldId);
  if (!handle || !handle.el.isConnected) return '';
  const { el, kind, optionEls } = handle;
  if (kind === 'radio' || kind === 'checkbox') return optionEls.filter(isChecked).map(optionLabel).join(', ');
  if (kind === 'select') return Array.from((el as HTMLSelectElement).selectedOptions, (option) => clean(option.textContent)).join(', ');
  if (kind === 'contenteditable') return el.textContent?.trim() ?? '';
  if (isWorkdayPicker(el)) return workdayPicked(el).join(', ') || el.value;
  const shownDate = workdayDateShown(el);
  if (shownDate !== null) return shownDate;
  if (kind === 'combobox' && handle.multi && chosenChips(el).length) return chosenChips(el).join(', ');
  if (kind === 'combobox') {
    const input = el.matches('input') ? (el as HTMLInputElement) : el.querySelector('input');
    return (input && shownValue(input)) || el.textContent?.trim() || '';
  }
  return (el as HTMLInputElement).value ?? '';
}

const userEdited = new WeakSet<EventTarget>();

// Only real keystrokes and clicks are trusted, so the extension's own events don't count.
export function trackUserEdits(): void {
  const note = (event: Event) => {
    if (event.isTrusted) event.composedPath().forEach((node) => userEdited.add(node));
  };
  document.addEventListener('input', note, true);
  document.addEventListener('change', note, true);
}

function stillHolds(fieldId: string, handle: Handle, chosen?: string): boolean {
  const current = readField(fieldId);
  if (handle.kind !== 'select' && handle.kind !== 'combobox') return Boolean(current);
  if (!PLACEHOLDER_OPTION.test(current)) return true;
  if (handle.kind === 'select' || !chosen) return false;
  // A closed multi-select list can stay in the page, so its option text proves nothing.
  const listId = handle.el.getAttribute('aria-controls') ?? handle.el.getAttribute('aria-owns');
  const list = handle.multi && listId ? (handle.el.getRootNode() as Document | ShadowRoot).getElementById(listId) : null;
  if (list?.querySelector('[role=option]')) return Boolean(list.querySelector('[aria-selected=true]'));
  // Many custom lists show the picked option beside an input that stays empty.
  const shown = handle.multi ? chosen.split(/\s*,\s*/) : [chosen];
  let node = handle.el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const text = clean(node.textContent);
    if (shown.some((item) => text.includes(item))) return true;
  }
  return false;
}

// Lists the filled fields the page has since blanked or rebuilt. A field the user edited stays theirs.
export function findLostFields(fields: { fieldId: string; chosen?: string }[]): string[] {
  return fields.filter(({ fieldId, chosen }) => {
    const handle = liveHandle(fieldId);
    if (!handle || !handle.el.isConnected) return true;
    const edited = [handle.el, ...handle.optionEls].some((el) => userEdited.has(el));
    return !edited && !stillHolds(fieldId, handle, chosen);
  }).map(({ fieldId }) => fieldId);
}

const ADD_GENERIC = /^\+?\s*add\s*(another|more|new|one more)?\b|^\+$/i;
const ADD_WORDS = {
  work: /employ|experience|work|job|position|role/i,
  education: /educat|school|degree|college|universit|qualification/i,
};

function buttonText(el: HTMLElement): string {
  return clean(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
}

// Finds the button that adds another work or education block next to a field of the last block.
function findAddButton(field: HTMLElement, group: 'work' | 'education'): HTMLElement | null {
  const words = ADD_WORDS[group];
  const other = ADD_WORDS[group === 'work' ? 'education' : 'work'];
  const fieldSection = sectionOf(field);
  let node: HTMLElement | null = field.parentElement;
  for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
    // The nearest wrapper that also holds the other section's fields is too wide for a plain "Add another".
    const mixed = other.test(clean(node.textContent));
    const buttons = Array.from(node.querySelectorAll<HTMLElement>('button, [role=button], a'));
    const found = buttons.find((button) => {
      if (button.matches('[type=submit], [disabled], [aria-disabled=true]') || !isVisible(button)) return false;
      const text = buttonText(button);
      if (text.length > 60 || !/\badd\b|^\+/i.test(text)) return false;
      if (other.test(text) && !words.test(text)) return false;
      if (words.test(text)) return true;
      return ADD_GENERIC.test(text) && (!mixed || sectionOf(button) === fieldSection);
    });
    if (found) return found;
  }
  return null;
}

// Clicks "Add another" for a repeating section. Rote never clicks submit, and this never matches one.
export async function addRow(fieldId: string, group: 'work' | 'education'): Promise<{ clicked: boolean; label: string }> {
  const handle = liveHandle(fieldId);
  if (!handle || !handle.el.isConnected) return { clicked: false, label: '' };
  const button = findAddButton(handle.el, group);
  if (!button) return { clicked: false, label: '' };
  const label = buttonText(button);
  pressSequence(button);
  await waitForSettle(400, 4000);
  log.info('row.added', { group, label });
  return { clicked: true, label };
}

export function showField(fieldId: string): boolean {
  const handle = liveHandle(fieldId);
  if (!handle || !handle.el.isConnected) return false;
  const target = visibleTarget(handle.el);
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.animate([{ boxShadow: '0 0 0 4px #2f6fed' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200 });
  return true;
}
