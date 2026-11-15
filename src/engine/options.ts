// Picks the page's option that best fits a stored value. Used to preview native
// selects in the plan and to choose from custom dropdowns while filling.
import type { AddressPlace } from '../shared/types';
import { normalize, tokens } from './text';

const STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
  in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
  vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
};
const STATE_ABBREVIATIONS = new Map(Object.entries(STATES).map(([abbr, name]) => [name, abbr]));

const COUNTRY_GROUPS = [
  ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
  ['united kingdom', 'uk', 'u k', 'great britain', 'gb', 'england'],
  ['canada', 'ca'],
];

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const DECLINE =/decline|prefer not|do not wish|don t wish|dont wish|choose not|not to answer|not to disclose|not to say|not to identify|rather not/;

const DEGREE_PATTERNS: [RegExp, RegExp][] = [
  [/\b(ph ?d|doctor|doctorate)\b/, /\b(ph ?d|doctor|doctorate|doctoral)\b/],
  [/\b(m ?b ?a)\b/, /\b(m ?b ?a|master)/],
  [/\b(m ?s|m ?a|m ?eng|master|masters)\b/, /\b(master|m ?s|m ?a)\b|masters/],
  [/\b(b ?s|b ?a|b ?sc|b ?eng|bachelor|bachelors)\b/, /\b(bachelor|b ?s|b ?a)\b|bachelors/],
  [/\b(a ?a|a ?s|associate|associates)\b/, /associate/],
  [/\b(high school|ged|diploma)\b/, /high school|ged|secondary/],
];

export const PLACEHOLDER_OPTION = /^[\s\-–—]*(|select( an?| one| your)?\b.*|choose\b.*|please select.*|none selected|pick .*)$/i;

function aliases(key: string, value: string): string[] {
  const norm = normalize(value);
  if (key === 'state') {
    const fromAbbr = STATES[norm];
    const toAbbr = STATE_ABBREVIATIONS.get(norm);
    return [norm, fromAbbr, toAbbr].filter(Boolean) as string[];
  }
  if (key === 'country') return COUNTRY_GROUPS.find((group) => group.includes(norm)) ?? [norm];
  // Place lists spell the state out, as in "Austin, Texas, United States".
  if (key === 'location' || key === 'city' || key === 'work.location') {
    const place = value.match(/^\s*(.+?),\s*([A-Za-z]{2})\.?\s*(?:\d{5}(?:-\d{4})?)?\s*$/);
    const state = place && STATES[place[2].toLowerCase()];
    if (state) return [norm, `${normalize(place[1])} ${state}`];
  }
  return [norm];
}

function predicate(key: string, value: string): ((option: string) => boolean) | undefined {
  const norm = normalize(value);
  if (norm === 'decline') return (option) => DECLINE.test(option);
  if (norm === 'yes' || norm === 'no') {
    return (option) => {
      const first = tokens(option)[0];
      if (first === norm) return true;
      if (norm === 'yes') return /^(true|i am|i do|i have|i identify)\b/.test(option) && !/\bnot\b/.test(option);
      return first === 'false' || /^i (am|do|have) not\b|^i don t\b|^i do not\b/.test(option);
    };
  }
  if (key === 'veteran') {
    if (norm === 'not a veteran') return (option) => /\bnot\b.*\bveteran\b|^no\b/.test(option);
    return (option) => /veteran/.test(option) && !/\bnot\b/.test(option) && !DECLINE.test(option);
  }
  if (/Month$/.test(key)) {
    const number = MONTH_NAMES.indexOf(norm.slice(0, 3)) + 1;
    if (!number) return undefined;
    return (option) => {
      const first = tokens(option)[0] ?? '';
      return first.startsWith(norm.slice(0, 3)) || Number(first) === number;
    };
  }
  if (key === 'edu.degree') {
    const pattern = DEGREE_PATTERNS.find(([stored]) => stored.test(norm));
    if (pattern) return (option) => pattern[1].test(option);
  }
  return undefined;
}

function containsTokens(haystack: string[], needle: string[]): boolean {
  if (!needle.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}

const literal = (text: string) => text.trim().toLowerCase();
const SYMBOL_NAME = /[a-z]+[+#]+(?![a-z0-9])/gi;
const symbolNames = (text: string) => (text.match(SYMBOL_NAME) ?? []).map((name) => name.toLowerCase());

// Normalizing drops + and #, but C, C# and C++ are different languages and A+ is not A.
function symbolsConflict(option: string, value: string): boolean {
  const wanted = symbolNames(value);
  const offered = symbolNames(option);
  if (wanted.length) return !wanted.every((name) => offered.includes(name));
  const valueWords = tokens(value);
  const plainWords = tokens(option.replace(SYMBOL_NAME, ' '));
  return offered.some((name) => valueWords.includes(normalize(name)) && !plainWords.includes(normalize(name)));
}

// Normalizing strips symbols, so C# and C++ both become "c". The written text decides first.
export function findOptionIndex(options: string[], text: string): number {
  const exact = options.findIndex((option) => literal(option) === literal(text));
  if (exact >= 0) return exact;
  const target = normalize(text);
  const close = options.flatMap((option, index) => (target && normalize(option) === target && !symbolsConflict(option, text) ? [index] : []));
  return close.length === 1 ? close[0] : -1;
}

// A saved checkbox answer is its labels joined with commas, and a label can hold a comma itself.
// Items this form doesn't offer are skipped, so a longer list still ticks the ones it does.
export function savedChoices(value: string, options: string[]): number[] {
  const labels = options.map((option) => (PLACEHOLDER_OPTION.test(option) ? '' : literal(option)));
  const found = new Set<number>();
  let rest = literal(value);
  while (rest) {
    let match = -1;
    labels.forEach((label, index) => {
      const fits = label && rest.startsWith(label) && /^\s*(,|$)/.test(rest.slice(label.length));
      if (fits && (match < 0 || label.length > labels[match].length)) match = index;
    });
    if (match >= 0) found.add(match);
    const end = match >= 0 ? labels[match].length : rest.indexOf(',');
    rest = end < 0 ? '' : rest.slice(end).replace(/^\s*,\s*/, '');
  }
  return [...found];
}

export function chooseOption(key: string, value: string, options: string[]): { index: number; score: number } | null {
  const written = literal(value) ? options.findIndex((option) => !PLACEHOLDER_OPTION.test(option) && literal(option) === literal(value)) : -1;
  if (written >= 0) return { index: written, score: 1 };
  const normalized = options.map((option) => (PLACEHOLDER_OPTION.test(option) || symbolsConflict(option, value) ? '' : normalize(option)));
  const candidates = aliases(key, value);

  for (const candidate of candidates) {
    const exact = normalized.indexOf(candidate);
    if (candidate && exact >= 0) return { index: exact, score: 1 };
  }
  const test = predicate(key, value);
  if (test) {
    const index = normalized.findIndex((option) => option && test(option));
    return index >= 0 ? { index, score: 0.9 } : null;
  }

  // Campuses differ by one word, so a school needs a closer match than other fields.
  const minimumOverlap = key === 'edu.school' ? 0.8 : 0.6;
  const scores = normalized.map(() => 0);
  let best: { index: number; score: number } | null = null;
  let bestLength = Infinity;
  normalized.forEach((option, index) => {
    if (!option) return;
    const optionTokens = tokens(option);
    for (const candidate of candidates) {
      const valueTokens = tokens(candidate);
      let score = 0;
      if (containsTokens(optionTokens, valueTokens) || containsTokens(valueTokens, optionTokens)) {
        score = 0.85;
      } else {
        const shared = valueTokens.filter((token) => optionTokens.includes(token)).length;
        const overlap = shared / Math.max(valueTokens.length, optionTokens.length);
        if (overlap >= minimumOverlap) score = 0.6 + overlap / 10;
      }
      scores[index] = Math.max(scores[index], score);
      // Among equal fits, the option with the fewest extra words is the closest one.
      if (score && (!best || score > best.score || (score === best.score && optionTokens.length < bestLength))) {
        best = { index, score };
        bestLength = optionTokens.length;
      }
    }
  });
  // "University of Texas" fits every campus equally, and guessing one would be wrong.
  const top = Math.max(0, ...scores);
  if (key === 'edu.school' && scores.filter((score) => score === top).length > 1) return null;
  return best;
}

const STREET_WORDS: Record<string, string> = {
  street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl', highway: 'hwy',
  parkway: 'pkwy', circle: 'cir', trail: 'trl', terrace: 'ter', north: 'n', south: 's', east: 'e', west: 'w',
};
const streetTokens = (text: string) => tokens(normalize(text)).map((token) => STREET_WORDS[token] ?? token);

// Picking an address suggestion can set the city and state too, so one from another town is never accepted.
export function chooseAddress(value: string, options: string[], place: AddressPlace | undefined): { index: number; score: number } | null {
  const street = streetTokens(value);
  const postal = normalize(place?.postalCode ?? '').split(' ')[0];
  const city = streetTokens(place?.city ?? '');
  const states = place?.state ? aliases('state', place.state).map(streetTokens) : [];
  const index = options.findIndex((option) => {
    const found = streetTokens(option);
    if (!street.length || found[0] !== street[0] || !street.every((token) => found.includes(token))) return false;
    if (postal && found.includes(postal)) return true;
    return containsTokens(found, city) && (!states.length || states.some((state) => containsTokens(found, state)));
  });
  return index >= 0 ? { index, score: 0.9 } : null;
}

// Searchable lists often miss a full value, so try shorter forms of it as well.
export function searchQueries(value: string): string[] {
  const words = value.trim().split(/\s+/);
  const shorter: string[] = [];
  for (let count = words.length - 1; count >= 1 && shorter.length < 3; count--) {
    if (!/^(?:at|of|in|the|and|for|&|-)$/i.test(words[count - 1])) shorter.push(words.slice(0, count).join(' '));
  }
  return [value, ...shorter];
}

// A skills list is joined with commas, and a skill can hold commas inside parentheses, as in "Linux (Ubuntu, RHEL)".
export function splitSkills(value: string): string[] {
  const skills: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(' || ch === '[') depth++;
    if ((ch === ')' || ch === ']') && depth) depth--;
    if ((ch === ',' || ch === ';' || ch === '\n') && !depth) {
      skills.push(current);
      current = '';
    } else current += ch;
  }
  skills.push(current);
  return skills.map((skill) => skill.replace(/^[\s•·*-]+/, '').trim()).filter(Boolean);
}

const withoutParens = (text: string) => text.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
const insideParens = (text: string) => Array.from(text.matchAll(/[([]([^)\]]*)[)\]]/g), (match) => match[1].trim()).filter(Boolean);
const unique = (items: string[]) => {
  const seen = new Set<string>();
  return items.map((item) => item.trim()).filter((item) => item.length > 1 && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()));
};

// The names one resume skill goes by: itself, without its parentheses, each part of a slashed name,
// and each name inside the parentheses. "Microsoft Entra ID (Azure AD)" is also "Azure AD".
function skillNames(skill: string): string[] {
  const base = withoutParens(skill);
  return unique([skill, base, ...base.split(/\s*\/\s*/), ...insideParens(skill).flatMap((inner) => inner.split(/\s*[,/;]\s*/))]);
}

// Searches to try for one skill. A skill list rarely holds a resume's wording whole, so after the
// skill's own names come shorter forms of it, with words dropped from the end.
export function skillQueries(skill: string): string[] {
  const names = skillNames(skill);
  const shorter = names.filter((name) => !/[()[\]/,]/.test(name)).flatMap((name) => {
    const words = name.split(/\s+/);
    const out: string[] = [];
    for (let count = words.length - 1; count >= 1 && out.length < 2; count--) {
      if (!STOP.has(words[count - 1].toLowerCase())) out.push(words.slice(0, count).join(' '));
    }
    return out;
  });
  return unique([...names, ...shorter]).slice(0, 5);
}

const STOP = new Set(['and', 'of', 'the', 'for', 'in', 'with', 'to', 'a', 'an', '&']);
// A plural s comes off, so VLANs fits VLAN and REST APIs fits REST API.
const singular = (word: string) => (word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word);
// Words keep + and #, so C, C# and C++ stay apart. Lower case first keeps JavaScript one word, apart from Java.
const skillWords = (text: string) => text.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim().split(' ').filter(Boolean).map(singular);
// A version or year says which release, not which skill, so Python 3 fits Python and Windows Server 2019 fits Windows Server.
const isVersion = (word: string) => /^(v?\d{1,2}(\.\d+)*|(19|20)\d\d)$/.test(word);
const meaningful = (words: string[]) => words.filter((word) => !STOP.has(word) && !isVersion(word));
const initials = (words: string[]) => words.filter((word) => !STOP.has(word)).map((word) => word[0]).join('');

function containsRun(haystack: string[], needle: string[]): boolean {
  if (!needle.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

// How well one name for the resume skill fits one name for a listed skill, from 0 to 100.
function fit(wanted: string, offered: string): number {
  const a = skillWords(wanted);
  const b = skillWords(offered);
  if (!a.length || !b.length) return 0;
  // Case, spacing and . - _ / can differ, as in Node.js and NodeJS.
  const squeeze = (text: string) => text.toLowerCase().replace(/[^a-z0-9+#]+/g, '');
  if (a.join('') === b.join('') || squeeze(wanted) === squeeze(offered)) return 100;
  // MFA fits Multi-Factor Authentication, and Single Sign-On fits SSO.
  const acronym = (short: string[], long: string[]) => short.length === 1 && /^[a-z]{2,6}$/.test(short[0]) && long.length >= 2 && initials(long) === short[0];
  if (acronym(a, b) || acronym(b, a)) return 90;
  const ma = meaningful(a);
  const mb = meaningful(b);
  if (ma.length && ma.join('') === mb.join('')) return 95;
  // The listed skill holds every word of the resume's, as in PowerShell and Windows PowerShell.
  if (containsRun(b, ma) || containsRun(mb, ma)) return 80 - Math.min(10, mb.length - ma.length);
  // The resume's holds the listed one, as in Microsoft Entra ID and Microsoft Entra. It has to cover
  // most of the resume's words, so Cisco alone never stands in for Cisco UCS.
  if (mb.length && (containsRun(a, mb) || containsRun(ma, mb)) && mb.length * 2 > ma.length) return 70 - Math.min(10, ma.length - mb.length);
  const shared = ma.filter((word) => mb.includes(word)).length;
  const overlap = shared / Math.max(ma.length, mb.length);
  return overlap >= 0.6 ? Math.round(50 + overlap * 10) : 0;
}

// Picks the listed skill closest to one from the resume, or -1 when none is close. A listed skill's
// own parentheses count as another name for it, so "Amazon Web Services (AWS)" fits AWS.
// Among equal fits the one with the fewest words wins.
export function chooseSkill(skill: string, options: string[]): number {
  const wanted = skillNames(skill);
  let best = -1;
  let bestScore = 0;
  let bestLength = Infinity;
  options.forEach((option, index) => {
    const offered = unique([option, withoutParens(option), ...insideParens(option)]);
    const score = Math.max(0, ...wanted.flatMap((name) => offered.map((other) => fit(name, other))));
    const length = skillWords(option).length;
    if (score > bestScore || (score && score === bestScore && length < bestLength)) {
      best = index;
      bestScore = score;
      bestLength = length;
    }
  });
  return best;
}
