// Rebuilds reading order from positioned PDF text. PDF stores text as placed
// fragments, so two-column resumes come out interleaved unless the columns are found first.

export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  text: string;
  columns: number;
}

const BINS = 100;

function findGutter(items: PdfItem[]): number | null {
  if (items.length < 8) return null;
  const left = Math.min(...items.map((item) => item.x));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const span = right - left;
  if (span <= 0) return null;

  const counts = new Array<number>(BINS).fill(0);
  const toBin = (x: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((x - left) / span) * BINS)));
  for (const item of items) {
    for (let bin = toBin(item.x); bin <= toBin(item.x + item.width); bin++) counts[bin]++;
  }

  const limit = Math.max(2, items.length * 0.05);
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let bin = 20; bin <= 80; bin++) {
    if (counts[bin] <= limit) {
      if (start < 0) start = bin;
      if (bin - start + 1 > bestLength) {
        bestStart = start;
        bestLength = bin - start + 1;
      }
    } else {
      start = -1;
    }
  }
  if (bestLength < 3) return null;

  const gutter = left + ((bestStart + bestLength / 2) / BINS) * span;
  const leftCount = items.filter((item) => item.x + item.width <= gutter).length;
  const rightCount = items.filter((item) => item.x >= gutter).length;
  // Right-aligned dates also leave a gap, but they are a small share of the page.
  if (Math.min(leftCount, rightCount) < items.length * 0.25) return null;
  return gutter;
}

function toLines(items: PdfItem[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(item.height, 6) * 0.5;
    if (row && Math.abs(row[0].y - item.y) <= tolerance) row.push(item);
    else rows.push([item]);
  }

  const lines: string[] = [];
  rows.forEach((row, rowIndex) => {
    row.sort((a, b) => a.x - b.x);
    let line = '';
    let end = row[0].x;
    for (const item of row) {
      const gap = item.x - end;
      const height = Math.max(item.height, 6);
      if (line && gap > height * 1.5) line += '   ';
      else if (line && gap > height * 0.15 && !line.endsWith(' ') && !item.str.startsWith(' ')) line += ' ';
      line += item.str;
      end = item.x + item.width;
    }
    const previous = rows[rowIndex - 1];
    if (previous && previous[0].y - row[0].y > Math.max(row[0].height, 6) * 1.9) lines.push('');
    lines.push(line.trimEnd());
  });
  return lines;
}

export function layoutPage(rawItems: PdfItem[]): LayoutResult {
  const items = rawItems.filter((item) => item.str.trim());
  const gutter = findGutter(items);
  if (gutter === null) return { text: toLines(items).join('\n'), columns: 1 };

  const spanning = items.filter((item) => item.x < gutter && item.x + item.width > gutter);
  const left = items.filter((item) => item.x + item.width <= gutter);
  const right = items.filter((item) => item.x >= gutter);
  const parts = [spanning, left, right].filter((part) => part.length).map((part) => toLines(part).join('\n'));
  return { text: parts.join('\n\n'), columns: 2 };
}
