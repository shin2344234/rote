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
