// Turns scanned fields and the profile into a fill plan and a list of profile gaps.
import type { BankAnswer, PlanRow, Profile, ScannedField, RowStatus } from '../shared/types';
import { CATALOG, CATALOG_BY_KEY, type CatalogEntry } from './catalog';
import { isBlocked, LOW_SCORE, READY_SCORE, repeatIndex, scoreField } from './match';
import { chooseOption, savedChoices } from './options';
import { normalize, readDate, similarity } from './text';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A date picker needs a month, and guessing January would put a wrong date on the application.
function formatDate(stored: string, field: ScannedField): string {
  const { year, month } = readDate(stored);
  if (!year) return '';
  const s = field.signals;
  if (s.inputType === 'date') return month ? `${year}-${month}-01` : '';
  if (s.inputType === 'month') return month ? `${year}-${month}` : '';
  if (!month) return year;
  const hint = s.placeholder.toLowerCase();
  if (/y{2,4}[-/.]m{1,2}/.test(hint)) return `${year}-${month}`;
  if (/m{1,2}[-/.]d{1,2}[-/.]y{2,4}/.test(hint)) return `${month}/01/${year}`;
  return `${month}/${year}`;
}

function datePart(stored: string, part: 'Month' | 'Year'): string {
  const { year, month } = readDate(stored);
  if (part === 'Year') return year;
  return month ? MONTH_NAMES[Number(month) - 1] : '';
}

export function valueFor(entry: CatalogEntry, index: number, profile: Profile, field: ScannedField): string {
  const [group, sub] = entry.key.split('.');
  if (group === 'work' || group === 'edu') {
    const record = (group === 'work' ? profile.work[index] : profile.education[index]) as unknown as Record<string, string> | undefined;
    if (!record) return '';
    // A single "Current role" box is ticked by choosing its own label.
    if (sub === 'current') return record.current ? field.options[0] ?? '' : '';
    const part = sub.match(/^(start|end)(Month|Year)$/);
    if (part) return datePart(record[part[1]], part[2] as 'Month' | 'Year');
    if (sub === 'start' || sub === 'end') return formatDate(record[sub], field);
    return record[sub] ?? '';
  }
  if (entry.key === 'skills') return profile.skills.join(', ');
  return profile.fields[entry.key] ?? '';
}

export interface PlanContext {
  profile: Profile;
  bank: BankAnswer[];
  resumeName?: string;
}

export function findBankAnswer(label: string, bank: BankAnswer[]): BankAnswer | undefined {
  const target = normalize(label);
  if (target.length < 8) return undefined;
  let best: BankAnswer | undefined;
  let bestScore = 0.85;
  for (const answer of bank) {
    if (answer.normalized === target) return answer;
    const score = similarity(answer.normalized, target);
    if (score >= bestScore) {
      best = answer;
      bestScore = score;
    }
  }
  return best;
}

export function displayLabel(field: ScannedField): string {
  const s = field.signals;
  return s.label || s.ariaLabel || s.legend || s.nearby || s.placeholder || s.name || s.id || `(unlabeled ${field.kind})`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function buildPlan(fields: ScannedField[], context: PlanContext): PlanRow[] {
  const scored = fields.map((field) => ({ field, candidates: scoreField(field) }));

  // Repeating sections may count from 0 or 1, so shift each group to start at 0.
  const minimums = new Map<string, number>();
  for (const { field, candidates } of scored) {
    const entry = candidates[0] && CATALOG_BY_KEY.get(candidates[0].key);
    const index = repeatIndex(field);
    if (entry?.repeat && index !== null) minimums.set(entry.repeat, Math.min(minimums.get(entry.repeat) ?? index, index));
  }

  const fileFields = fields.filter((field) => field.kind === 'file');
  const claimed = new Map<string, { row: PlanRow; raw: number }>();

  const rows = scored.map(({ field, candidates }) => {
    const row: PlanRow = {
      fieldId: field.fieldId,
      frameId: field.frameId,
      frameHost: hostOf(field.frameUrl),
      label: displayLabel(field),
      kind: field.kind,
      required: field.required,
      key: '',
      keyLabel: '',
      index: 0,
      score: 0,
      status: 'unmatched',
      value: '',
      reason: '',
      candidates: candidates.slice(0, 3).map(({ key, score }) => ({ key, score })),
    };

    if (isBlocked(field)) {
      row.status = 'blocked';
      row.reason = 'Sensitive identifier. This tool never stores or fills these.';
      return row;
    }
    if (field.kind === 'checkbox' && field.options.length < 2 && candidates[0]?.key !== 'work.current') {
      row.reason = 'Single checkboxes are often consent statements, so they are left for you.';
      return row;
    }

    let top = candidates[0];
    if (!top && field.kind === 'file' && fileFields.length === 1) top = { key: 'resumeUpload', raw: 0.65, score: 0.65 };

    if (!top || top.raw < LOW_SCORE) {
      const saved = findBankAnswer(row.label, context.bank);
      if (saved && !field.hasValue) {
        row.status = 'suggested';
        row.value = saved.answer;
        row.reason = 'Answer bank has a saved answer for this question.';
      } else {
        row.reason = field.hasValue ? 'Not recognized. The page already has a value.' : 'Not recognized.';
      }
      return row;
    }

    const entry = CATALOG_BY_KEY.get(top.key)!;
    const rawIndex = entry.repeat ? repeatIndex(field) : null;
    row.key = entry.key;
    row.keyLabel = entry.label;
    row.index = rawIndex === null ? 0 : rawIndex - (minimums.get(entry.repeat!) ?? 0);
    row.score = top.score;
    if (entry.key === 'addressLine1') {
      const { city, state, postalCode } = context.profile.fields;
      row.place = { city, state, postalCode };
    }

    const slot = `${entry.key}:${row.index}`;
    const holder = claimed.get(slot);
    // Forms often ask for the legal name again further down, and both questions want an answer.
    const legalAgain = holder && /\blegal\b/i.test(`${row.label} ${holder.row.label}`);
    if (holder && !entry.allowDuplicates && !legalAgain) {
      const loser = top.raw > holder.raw ? holder.row : row;
      if (top.raw > holder.raw) claimed.set(slot, { row, raw: top.raw });
      loser.status = 'unmatched';
      loser.reason = `Another field on this page matched "${entry.label}" better.`;
      loser.value = '';
      loser.key = '';
      loser.keyLabel = '';
      if (loser === row) return row;
    } else if (!holder) {
      claimed.set(slot, { row, raw: top.raw });
    }

    if (entry.source === 'file') {
      row.value = entry.key === 'resumeUpload' ? context.resumeName ?? '' : '';
      row.status = classify(field, entry, row.value, top.score);
      if (!row.value) row.reason = entry.key === 'resumeUpload' ? 'No resume stored.' : 'Cover letter files are not supported in v1.';
      return row;
    }

    const value = valueFor(entry, row.index, context.profile, field);
    row.value = value;
    row.status = classify(field, entry, value, top.score);
    if (row.status === 'missing') row.reason = missingReason(entry, row.index, context.profile);
    if (row.status === 'existing') row.reason = 'The page already has a value.';
    if (row.status === 'no-option') row.reason = 'None of the choices on the page fit your saved answer.';
    if (row.status === 'confirm') row.reason = 'Sensitive answer. Confirm it for this application.';
    if (row.status === 'low') row.reason = 'Probable match. Check this one.';
    return row;
  });
  return rows;
}

function missingReason(entry: CatalogEntry, index: number, profile: Profile): string {
  if (entry.key === 'work.current') return 'This job is not marked as your current one.';
  const [group, sub] = entry.key.split('.');
  const record = group === 'work' ? profile.work[index] : group === 'edu' ? profile.education[index] : undefined;
  const side = sub?.match(/^(start|end)/)?.[1] as 'start' | 'end' | undefined;
  if (record && side) {
    if (side === 'end' && group === 'work' && profile.work[index].current) return 'This is your current job, so it has no end date.';
    const { year, month } = readDate(record[side]);
    const which = group === 'work' ? 'job' : 'school';
    if (year && !month) return `Your profile has only the year for this ${which}. Add the month in your profile, as ${year}-06 for June.`;
  }
  return 'Your profile has no value for this.';
}

function classify(field: ScannedField, entry: CatalogEntry, value: string, score: number): RowStatus {
  if (field.hasValue) return 'existing';
  if (!value) return 'missing';
  const takesMany = field.multiple || field.kind === 'checkbox';
  if (field.options.length && !chooseOption(entry.key, value, field.options) && !(takesMany && savedChoices(value, field.options).length)) return 'no-option';
  if (entry.sensitive) return 'confirm';
  return score >= READY_SCORE ? 'ready' : 'low';
}

export interface ProfileGap {
  key: string;
  label: string;
  source: 'resume' | 'answer';
}

// Fields worth having that the profile lacks. Split by whether a resume could have supplied them.
export function profileGaps(profile: Profile): ProfileGap[] {
  const gaps: ProfileGap[] = CATALOG.filter((entry) => entry.gap && !profile.fields[entry.key]).map((entry) => ({
    key: entry.key,
    label: entry.label,
    source: entry.source === 'answer' ? 'answer' : 'resume',
  }));
  if (!profile.work.length) gaps.push({ key: 'work', label: 'Work history', source: 'resume' });
  const yearOnly = (date: string) => Boolean(readDate(date).year) && !readDate(date).month;
  if (profile.work.some((job) => yearOnly(job.start) || (!job.current && yearOnly(job.end)))) {
    gaps.push({ key: 'work.months', label: 'Months for your job dates, since the resume gives only years', source: 'resume' });
  }
  if (!profile.education.length) gaps.push({ key: 'education', label: 'Education, if you have any', source: 'resume' });
  if (!profile.skills.length) gaps.push({ key: 'skills', label: 'Skills', source: 'resume' });
  return gaps;
}
