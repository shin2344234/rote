// Text helpers shared by the matcher, parser and answer bank.

export function normalize(input: string): string {
  return (input ?? '')
    .replace(/Linked[Ii]n/g, 'linkedin')
    .replace(/Git[Hh]ub/g, 'github')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokens(input: string): string[] {
  const norm = normalize(input);
  return norm ? norm.split(' ') : [];
}

export function similarity(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

const MONTH_PREFIXES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Profile dates are stored as YYYY or YYYY-MM, but a person may type "Jun 2023" or "06/2023".
export function readDate(stored: string): { year: string; month: string } {
  const value = (stored ?? '').trim().toLowerCase();
  const year = value.match(/\b(19|20)\d{2}\b/)?.[0] ?? '';
  if (!year) return { year: '', month: '' };
  const rest = value.replace(year, ' ');
  const named = MONTH_PREFIXES.findIndex((name) => new RegExp(`\\b${name}`).test(rest));
  let month = named >= 0 ? named + 1 : 0;
  if (!month) {
    const number = rest.match(/(?:^|[^\d])(\d{1,2})(?:[^\d]|$)/)?.[1];
    if (number && Number(number) >= 1 && Number(number) <= 12) month = Number(number);
  }
  return { year, month: month ? String(month).padStart(2, '0') : '' };
}

export function storedDate(input: string): string {
  const { year, month } = readDate(input);
  if (!year) return input.trim();
  return month ? `${year}-${month}` : year;
}
