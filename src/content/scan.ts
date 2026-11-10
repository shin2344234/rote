// Finds form fields in this frame, including inside shadow roots, and records
// what the page says about each one. It reads structure only and changes nothing.
import { PLACEHOLDER_OPTION } from '../engine/options';
import type { FieldKind, FieldSignals, ScannedField } from '../shared/types';
import { stripUrl } from '../shared/log';

export interface Handle {
  kind: FieldKind;
  el: HTMLElement;
  optionEls: HTMLElement[];
  dropzone: boolean;
  multi: boolean;
}

export const handles = new Map<string, Handle>();

const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'search', 'range', 'color']);
const CONTROLS = 'input,select,textarea,button,[role=combobox],[role=radio],[role=checkbox],[contenteditable=true]';
const DROP_TEXT = /drag\s*(and|&|n|or)\s*drop|drop\s+(your\s+|a\s+)?(file|resume|cv)/i;

function collectElements(root: ParentNode, out: Element[]): void {
  for (const el of root.querySelectorAll('*')) {
    out.push(el);
    let shadow = el.shadowRoot;
    if (!shadow && el.tagName.includes('-')) {
      try {
        shadow = chrome.dom?.openOrClosedShadowRoot(el as HTMLElement) ?? null;
      } catch {
        shadow = null;
      }
    }
    if (shadow) collectElements(shadow, out);
  }
}

export function clean(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*(required|optional)\s*\)/gi, '')
    .replace(/[*∗✱]/g, '')
    .trim()
    .slice(0, 300);
}

function textWithoutControls(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.matches('select,textarea,script,style,svg,input')) return '';
  return Array.from(node.childNodes).map(textWithoutControls).join(' ');
}

// Job pages often carry a mailing-list box that would otherwise match "email".
function isSiteChrome(el: Element): boolean {
  if (el.closest('footer')) return true;
  const form = el.closest('form');
  return Boolean(form && /newsletter|subscribe|mailing.?list/i.test(`${form.id} ${form.className} ${form.getAttribute('action') ?? ''}`));
}

export function isVisible(el: HTMLElement, minimum = 2): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= minimum && rect.height >= minimum && el.checkVisibility({ visibilityProperty: true });
}

function byIdRefs(el: Element, attribute: string): string {
  const ids = el.getAttribute(attribute);
  if (!ids) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return clean(ids.split(/\s+/).map((id) => root.getElementById(id)?.textContent ?? '').join(' '));
}

function labelOf(el: HTMLElement): string {
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) {
    const text = clean(Array.from(labels).map(textWithoutControls).join(' '));
    if (text) return text;
  }
  return byIdRefs(el, 'aria-labelledby');
}

// Text that sits just before the control. Stops at another control so one field can't take a neighbor's label.
function nearbyText(start: Element): string {
  let node: Element | null = start;
  for (let depth = 0; node && depth < 4; depth++) {
    let sibling = node.previousElementSibling;
    for (let step = 0; sibling && step < 3; step++) {
      if (sibling.matches(CONTROLS) || sibling.querySelector(CONTROLS)) return '';
      const text = clean(textWithoutControls(sibling));
      if (text && text.length <= 250) return text;
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
    if (node?.matches('form,body')) return '';
  }
  return '';
}

// Some forms title a section with a styled div, such as <div class="education--header">.
// A repeated block's header can hold its own Remove button, as Greenhouse's added employment blocks do.
const ENTRY_CONTROLS = CONTROLS.split(',').filter((selector) => selector !== 'button').join(',');

function headingText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('button').forEach((button) => button.remove());
  return clean(copy.textContent);
}

function isStyledHeading(el: Element): boolean {
  if (el.matches('label') || !/head|title/i.test(`${el.id} ${el.className}`) || el.querySelector(ENTRY_CONTROLS)) return false;
  const text = headingText(el);
  return text.length > 0 && text.length <= 60;
}

// After a server-side upload, iCIMS shows the stored file as text beside an empty input.
// A name directly before the extension keeps hints like "Accepted: .pdf, .docx" from counting.
const ATTACHED_FILE = /[\w)-]\.(pdf|docx?|rtf|odt|txt)\b/i;

function showsAttachedFile(input: HTMLInputElement): boolean {
  let node: HTMLElement | null = input.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const text = node.innerText ?? '';
    if (text.length > 800) return false;
    if (ATTACHED_FILE.test(text)) return true;
  }
  return false;
}

export function sectionOf(el: Element): string {
  const heading = 'h1,h2,h3,h4,h5,h6,legend,[role=heading]';
  let node: Element | null = el;
  for (let depth = 0; node && depth < 12; depth++) {
    let sibling = node.previousElementSibling;
    for (let step = 0; sibling && step < 12; step++) {
      if (sibling.matches(heading)) return clean(sibling.textContent);
      if (isStyledHeading(sibling)) return headingText(sibling);
      const inner = sibling.querySelectorAll(heading);
      if (inner.length) return clean(inner[inner.length - 1].textContent);
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
    if (node?.matches('fieldset') && node.querySelector(':scope > legend')) {
      return clean(node.querySelector(':scope > legend')!.textContent);
    }
  }
  return '';
}

function domPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${node.id}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((child) => child.tagName === node!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

function signalsOf(el: HTMLElement, legend = ''): FieldSignals {
  const input = el as HTMLInputElement;
  return {
    label: labelOf(el),
    ariaLabel: clean(el.getAttribute('aria-label')),
    legend,
    nearby: nearbyText(el),
    section: sectionOf(el),
    name: el.getAttribute('name') ?? '',
    id: el.id ?? '',
    automationId: el.getAttribute('data-automation-id') ?? el.getAttribute('data-testid') ?? el.getAttribute('data-qa') ?? '',
    placeholder: clean(el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder')),
    autocomplete: el.getAttribute('autocomplete') ?? '',
    inputType: el.tagName === 'INPUT' ? input.type : '',
  };
}

const SHOWN_VALUE = '[class*=single-value i],[class*=singleValue i],[class*=selected-value i],[class*=selection__rendered i]';
const DROPDOWN_WRAPPER = '[aria-haspopup=listbox],[aria-expanded]';
const PROMPT_TEXT = /^(search|type|start typing|begin typing|no (results|options)|loading)\b/i;

// Custom dropdowns often keep the input empty and show the chosen option in an element beside it.
export function shownValue(input: HTMLInputElement): string {
  const typed = input.value.trim();
  if (typed) return typed;
  let node = input.parentElement;
  for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
    if (node.querySelectorAll('input,select,textarea').length > 1 || node.querySelector('label')) return '';
    const shown = node.querySelector<HTMLElement>(SHOWN_VALUE) ?? (node.matches(DROPDOWN_WRAPPER) ? node : null);
    if (!shown) continue;
    const text = clean(shown.textContent);
    return PLACEHOLDER_OPTION.test(text) || PROMPT_TEXT.test(text) || text === input.placeholder ? '' : text;
  }
  return '';
}

const MULTI_CLASS = /is-?multi|multi-?select|multiple|has-?multi/i;
const CHIP = '[class*=multi-value i],[class*=multiValue i],[class*=selection__choice i],[class*=chip i],[class*=pill i],[class*=token i]';
// Widgets often carry a hidden input for the submitted value, and that isn't a second field.
const FIELD_CONTROLS = 'input:not([type=hidden]),select,textarea,[role=combobox]';

// Multi-select widgets say so with aria-multiselectable or a class on the widget's own wrapper.
export function isMultiCombobox(el: HTMLElement): boolean {
  if (el.closest('[aria-multiselectable=true]')) return true;
  const listId = el.getAttribute('aria-controls') ?? el.getAttribute('aria-owns');
  if (listId && (el.getRootNode() as Document | ShadowRoot).getElementById(listId)?.getAttribute('aria-multiselectable') === 'true') return true;
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 4 && node.querySelectorAll(FIELD_CONTROLS).length <= 1; depth++, node = node.parentElement) {
    if (MULTI_CLASS.test(node.className)) return true;
  }
  return false;
}

// Picked items usually sit beside the control as removable chips.
export function chipElements(el: HTMLElement): HTMLElement[] {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 4 && node.querySelectorAll(FIELD_CONTROLS).length <= 1; depth++, node = node.parentElement) {
    const chips = Array.from(node.querySelectorAll<HTMLElement>(CHIP)).filter((chip) => !chip.parentElement?.closest(CHIP) && chipText(chip));
    if (chips.length) return chips;
  }
  return [];
}

export const chipText = (chip: HTMLElement) => clean(chip.textContent).replace(/\s*[×✕✖]\s*/g, '');
export const chosenChips = (el: HTMLElement) => chipElements(el).map(chipText);

export function comboboxHasValue(el: HTMLElement): boolean {
  if (isMultiCombobox(el) && chosenChips(el).length) return true;
  const input = el.matches('input') ? (el as HTMLInputElement) : el.querySelector('input');
  if (input) return Boolean(shownValue(input));
  return !PLACEHOLDER_OPTION.test(clean(el.textContent));
}

// Styled dropdowns can pair a menu button with a hidden native select that holds the label and name.
function pairedSelect(el: HTMLElement): HTMLSelectElement | null {
  if (!el.matches('button[aria-haspopup]:not([aria-haspopup=false])')) return null;
  let node = el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const selects = node.querySelectorAll('select');
    if (selects.length) return selects.length === 1 && !isVisible(selects[0], 1) ? selects[0] : null;
    // A plain button here is usually the dropdown's own clear button, so only real fields stop the search.
    if (node.querySelectorAll('input,textarea,[aria-haspopup]').length > 1) return null;
  }
  return null;
}

function pairedSignals(el: HTMLElement, select: HTMLSelectElement): FieldSignals {
  const signals = signalsOf(el);
  return {
    ...signals,
    label: labelOf(select) || signals.label,
    // The button's aria-label often repeats the shown choice after the field name.
    ariaLabel: clean(signals.ariaLabel.replace(clean(el.textContent), '')),
    name: select.name,
    id: select.id,
  };
}

export function selectHasValue(el: HTMLSelectElement): boolean {
  return Array.from(el.selectedOptions).some((selected) => selected.value && !PLACEHOLDER_OPTION.test(clean(selected.textContent)));
}

export function optionLabel(el: HTMLElement): string {
  const fromLabel = labelOf(el) || clean(el.getAttribute('aria-label'));
  if (fromLabel) return fromLabel;
  if (el.tagName !== 'INPUT') return clean(el.textContent);
  const after = el.nextSibling ? clean(el.nextSibling.textContent) : '';
  return after || clean(el.parentElement?.textContent) || (el as HTMLInputElement).value;
}

function commonAncestor(elements: Element[]): Element {
  let ancestor = elements[0].parentElement ?? elements[0];
  while (ancestor.parentElement && !elements.every((el) => ancestor.contains(el))) ancestor = ancestor.parentElement;
  return ancestor;
}

function groupLabel(container: Element): string {
  const fieldset = container.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  if (legend) return clean(textWithoutControls(legend));
  const group = container.closest('[role=radiogroup],[role=group]') ?? container;
  return byIdRefs(group, 'aria-labelledby') || clean(group.getAttribute('aria-label')) || nearbyText(group);
}

export interface ScanResult {
  fields: ScannedField[];
  skipped: Record<string, number>;
  totalElements: number;
}

export function scanFrame(frameId: number): ScanResult {
  handles.clear();
  const fields: ScannedField[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);
  const frameUrl = stripUrl(location.href);
  let counter = 0;

  const add = (
    el: HTMLElement,
    kind: FieldKind,
    extra: { hasValue: boolean; options?: string[]; optionEls?: HTMLElement[]; signals?: FieldSignals; dropzone?: boolean; required?: boolean; multiple?: boolean },
  ) => {
    const fieldId = `f${counter++}`;
    handles.set(fieldId, { kind, el, optionEls: extra.optionEls ?? [], dropzone: extra.dropzone ?? false, multi: extra.multiple ?? false });
    const input = el as HTMLInputElement;
    fields.push({
      fieldId,
      frameId,
      frameUrl,
      kind,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? '',
      domPath: domPath(el),
      required: extra.required === true || input.required === true || el.getAttribute('aria-required') === 'true',
      hasValue: extra.hasValue,
      options: extra.options ?? [],
      multiple: extra.multiple ?? false,
      accept: input.accept ?? '',
      dropzone: extra.dropzone ?? false,
      signals: extra.signals ?? signalsOf(el),
    });
  };

  const elements: Element[] = [];
  collectElements(document, elements);
  const groups = new Map<unknown, HTMLElement[]>();
  const fileInputs: HTMLInputElement[] = [];

  for (const node of elements) {
    if (!(node instanceof HTMLElement)) continue;
    const el = node;
    const role = el.getAttribute('role');

    if (el.matches('input[type=radio],input[type=checkbox],[role=radio],[role=checkbox]')) {
      if ((el as HTMLInputElement).disabled) { skip('disabled'); continue; }
      const labelVisible = Array.from((el as HTMLInputElement).labels ?? []).some((label) => isVisible(label));
      if (!isVisible(el) && !labelVisible) { skip('hidden choice'); continue; }
      const name = el.getAttribute('name');
      const type = (el as HTMLInputElement).type === 'radio' || role === 'radio' ? 'radio' : 'checkbox';
      const key = name ? `${type}:${name}` : el.closest('[role=radiogroup],[role=group],fieldset') ?? el.parentElement;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(el);
      continue;
    }

    const paired = pairedSelect(el);
    const isCombobox =
      Boolean(paired) || role === 'combobox' || el.matches('button[aria-haspopup=listbox],[role=button][aria-haspopup=listbox],input[aria-autocomplete=list]');
    if (isCombobox) {
      const outer = el.parentElement?.closest('[role=combobox]');
      if (outer) { skip('inside combobox'); continue; }
      if ((el as HTMLInputElement).disabled) { skip('disabled'); continue; }
      if (!isVisible(el)) { skip('hidden combobox'); continue; }
      add(el, 'combobox', { hasValue: comboboxHasValue(el), required: paired?.required, signals: paired ? pairedSignals(el, paired) : undefined, multiple: isMultiCombobox(el) });
      continue;
    }

    if (el instanceof HTMLInputElement) {
      if (SKIPPED_INPUT_TYPES.has(el.type)) continue;
      if (el.closest('[role=combobox]')) { skip('inside combobox'); continue; }
      if (el.type === 'file') {
        if (el.disabled) { skip('disabled'); continue; }
        fileInputs.push(el);
        add(el, 'file', { hasValue: (el.files?.length ?? 0) > 0 || showsAttachedFile(el) });
        continue;
      }
      if (el.disabled || el.readOnly) { skip('disabled or read-only'); continue; }
      if (el.getAttribute('aria-hidden') === 'true') { skip('aria-hidden helper input'); continue; }
      if (isSiteChrome(el)) { skip('footer or newsletter form'); continue; }
      if (!isVisible(el)) { skip('hidden input'); continue; }
      add(el, el.type === 'date' || el.type === 'month' ? 'date' : 'text', { hasValue: Boolean(el.value.trim()) });
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.disabled || el.readOnly) { skip('disabled or read-only'); continue; }
      if (!isVisible(el)) { skip('hidden textarea'); continue; }
      add(el, 'textarea', { hasValue: Boolean(el.value.trim()) });
    } else if (el instanceof HTMLSelectElement) {
      if (el.disabled) { skip('disabled'); continue; }
      if (!isVisible(el, 1)) { skip('hidden select'); continue; }
      const options = Array.from(el.options).map((option) => clean(option.textContent));
      add(el, 'select', { options, hasValue: selectHasValue(el), multiple: el.multiple });
    } else if (el.getAttribute('contenteditable') !== null && el.getAttribute('contenteditable') !== 'false') {
      if (el.parentElement?.isContentEditable) continue;
      if (!isVisible(el)) { skip('hidden editor'); continue; }
      add(el, 'contenteditable', { hasValue: Boolean(el.textContent?.trim()) });
    }
  }

  for (const members of groups.values()) {
    const container = members.length > 1 ? commonAncestor(members) : members[0];
    const label = members.length > 1 ? groupLabel(container) : '';
    const isRadio = members[0].matches('input[type=radio],[role=radio]');
    const options = members.map(optionLabel);
    const signals = signalsOf(members[0], label);
    if (members.length > 1) {
      signals.label = '';
      signals.ariaLabel = clean(container.getAttribute('aria-label'));
      signals.section = sectionOf(container);
    }
    const hasValue = members.some((el) => (el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true');
    add(members[0], isRadio ? 'radio' : 'checkbox', { options, optionEls: members, signals, hasValue });
  }

  // Upload areas that have no file input of their own.
  const zones = elements.filter((el): el is HTMLElement =>
    el instanceof HTMLElement && el.childElementCount <= 8 && (el.textContent?.length ?? 0) < 300 && !el.matches('script,style,label') &&
    (DROP_TEXT.test(el.textContent ?? '') || /drop-?zone/i.test(el.className?.toString() ?? '')));
  const innermost = zones.filter((zone) => !zones.some((other) => other !== zone && zone.contains(other)));
  for (const zone of innermost) {
    const covered = fileInputs.some((input) => zone.contains(input) || zone.parentElement?.contains(input) || zone.parentElement?.parentElement?.contains(input));
    if (covered || !isVisible(zone)) continue;
    const signals = signalsOf(zone);
    signals.label = clean(zone.textContent);
    add(zone, 'file', { hasValue: false, signals, dropzone: true });
  }

  return { fields, skipped, totalElements: elements.length };
}
