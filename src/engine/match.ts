// Generic field recognition. Scores a scanned field against every catalog entry
// using what the page says about it. There are no per-site rules.
import type { Candidate, ScannedField } from '../shared/types';
import { BLOCKED_PATTERN, CATALOG, type CatalogEntry } from './catalog';
import { normalize } from './text';

export const READY_SCORE = 0.8;
export const LOW_SCORE = 0.6;

const IGNORED_TOKENS = new Set([
  'your', 'please', 'enter', 'the', 'a', 'an', 'provide', 'my', 'type', 'here', 'what', 'is', 'required', 'optional',
  'job', 'application', 'applicant', 'candidate', 'input', 'field', 'form', 'answer', 'question', 'txt', 'fld', 'data', 'info', 'details',
]);

// Numbers are noise in names like "address2", unless the phrase asks for one, as "at least 18" does.
function significantTokens(text: string, needle: string[]): string[] {
  const all = normalize(text).split(' ').filter(Boolean);
  return all.filter((token) => !IGNORED_TOKENS.has(token)).filter((token) => !/^\d+$/.test(token) || needle.includes(token));
}

export function phraseScore(text: string, phrase: string, distinctive = false): number {
  if (!text) return 0;
  const needle = phrase.split(' ');
  const haystack = significantTokens(text, needle);
  if (!haystack.length) return 0;

  let found = false;
  for (let start = 0; !found && start <= haystack.length - needle.length; start++) {
    found = needle.every((token, offset) => haystack[start + offset] === token);
  }
  // Identifiers such as "firstname" arrive as one token.
  const joined = needle.join('');
  if (!found && needle.length > 1 && haystack.includes(joined)) found = true;
  if (!found) return 0;

  const coverage = Math.min(1, needle.length / haystack.length);
  const score = 0.4 + 0.6 * coverage;
  return distinctive ? Math.max(score, 0.85) : score;
}

function hasNegative(entry: CatalogEntry, field: ScannedField): boolean {
  if (!entry.negative) return false;
  const s = field.signals;
  const text = normalize([s.label, s.ariaLabel, s.legend, s.name, s.id, s.automationId, s.placeholder].join(' '));
  return entry.negative.some((word) => new RegExp(`\\b${word.trim()}`).test(text));
}

function autocompleteMatches(entry: CatalogEntry, value: string): boolean {
  if (!entry.autocomplete || !value) return false;
  return value.toLowerCase().split(/\s+/).some((token) => entry.autocomplete!.includes(token));
}

// Raw score can pass 1 so that agreeing signals break ties. Display values are clamped.
function rawScore(entry: CatalogEntry, field: ScannedField): number {
  if (!entry.kinds.includes(field.kind)) return 0;
  const s = field.signals;
  const contextText = [s.section, s.legend, s.name, s.id, s.automationId, s.label].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (entry.context && !entry.context.test(contextText)) return 0;
  if (entry.excludeContext?.test(contextText)) return 0;
  if (hasNegative(entry, field)) return 0;

  const named = Boolean(s.label || s.ariaLabel);
  const grouped = field.kind === 'radio' || field.kind === 'checkbox';
  const signals: [string, number][] = [
    [s.label, 1],
    [s.ariaLabel, 1],
    [grouped || !named ? s.legend : '', 0.95],
    [s.name, 0.85],
    [s.id, 0.85],
    [s.automationId, 0.85],
    [s.placeholder, 0.8],
    [named ? '' : s.nearby, 0.85],
  ];

  let best = autocompleteMatches(entry, s.autocomplete) ? 0.98 : 0;
  if (s.inputType === 'email' && entry.key === 'email') best = Math.max(best, 0.75);
  if (s.inputType === 'tel' && entry.key === 'phone') best = Math.max(best, 0.75);

  let hits = 0;
  for (const [text, weight] of signals) {
    const score = Math.max(0, ...entry.phrases.map((phrase) => phraseScore(text, phrase, entry.distinctive))) * weight;
    if (score > 0) {
      hits++;
      best = Math.max(best, score);
    }
  }
  if (best === 0) return 0;
  const contextBonus = entry.context ? 0.03 : 0;
  return best + Math.max(0, hits - 1) * 0.04 + contextBonus;
}

export interface Scored extends Candidate {
  raw: number;
}

export function scoreField(field: ScannedField): Scored[] {
  return CATALOG.map((entry) => {
    const raw = rawScore(entry, field);
    return { key: entry.key, raw, score: Math.min(1, Number(raw.toFixed(3))) };
  })
    .filter((candidate) => candidate.raw > 0)
    .sort((a, b) => b.raw - a.raw);
}

export function isBlocked(field: ScannedField): boolean {
  const s = field.signals;
  if (s.inputType === 'password') return true;
  return BLOCKED_PATTERN.test(normalize([s.label, s.ariaLabel, s.name, s.id, s.automationId, s.placeholder, s.label || s.ariaLabel ? '' : s.nearby].join(' ')));
}

// Form builders number every control, so input-12 says nothing about which job or school it belongs to.
const GENERIC_ID = /^(?:input|field|text|question|q|fld|txt|ctl|form|element|el|select|id)[-_.]\d{1,2}$/i;

// Row number in repeating sections, read from names like educations[0] or workExperience-2--title.
export function repeatIndex(field: ScannedField): number | null {
  for (const text of [field.signals.name, field.signals.id, field.signals.automationId]) {
    if (GENERIC_ID.test(text)) continue;
    const match = text.match(/(?:\[|[-_.])(\d{1,2})(?:\]|[-_.]|$)/);
    if (match) return Number(match[1]);
  }
  return null;
}
