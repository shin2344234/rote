// Rule-based resume parser. Takes plain text and returns a draft profile plus a
// record of what was found and how, which goes to the log and the review screen.
import type { EducationEntry, ParseFinding, ParsedResume, Profile, WorkEntry } from '../shared/types';
import { normalize } from '../engine/text';

type Section = 'contact' | 'summary' | 'experience' | 'education' | 'skills' | 'other';

const HEADINGS: Record<string, Section> = {
  contact: 'contact', 'contact information': 'contact', 'contact info': 'contact', 'personal information': 'contact',
  summary: 'summary', 'professional summary': 'summary', 'career summary': 'summary', 'executive summary': 'summary', profile: 'summary', 'professional profile': 'summary', objective: 'summary', 'career objective': 'summary', about: 'summary', 'about me': 'summary',
  experience: 'experience', 'work experience': 'experience', 'professional experience': 'experience', 'employment history': 'experience', employment: 'experience', 'work history': 'experience', 'career history': 'experience', 'relevant experience': 'experience',
  education: 'education', 'education and training': 'education', 'academic background': 'education', 'academic history': 'education',
  skills: 'skills', 'technical skills': 'skills', 'core skills': 'skills', 'key skills': 'skills', 'core competencies': 'skills', competencies: 'skills', technologies: 'skills', 'skills and tools': 'skills',
  projects: 'other', 'personal projects': 'other', certifications: 'other', certificates: 'other', 'licenses and certifications': 'other', awards: 'other', honors: 'other', publications: 'other', volunteer: 'other', 'volunteer experience': 'other', interests: 'other', references: 'other', languages: 'other',
};

// Headings with a qualifier, such as "Selected projects", that end the work section.
const OTHER_HEADING = /\b(?:projects|certifications?|certificates|awards|honors|publications|activities|affiliations|memberships|patents)$/;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_PATTERN = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_PATTERN = `(?:${MONTH_PATTERN}\\.?,?\\s+\\d{4}|\\d{1,2}[/-]\\d{4}|\\d{4})`;
const RANGE = new RegExp(`(${DATE_PATTERN})\\s*(?:-|–|—|to|through|until)\\s*(${DATE_PATTERN}|present|current|now|today)`, 'i');

const BULLET = /^[•‣◦⁃∙▪●■*\-–—o]\s+/;
const LOCATION = /^(?:[A-Z][A-Za-z.' -]+,\s*[A-Z]{2}(?:\s+\d{5})?|remote|hybrid)$/i;
const TITLE_WORDS = /\b(engineer|developer|manager|analyst|director|specialist|administrator|consultant|technician|coordinator|lead|architect|designer|scientist|intern|assistant|associate|officer|president|head|supervisor|representative|programmer|accountant|nurse|teacher|recruiter|strategist|owner|founder|sales|support)\b/i;
const COMPANY_WORDS = /\b(inc|llc|ltd|corp|corporation|company|co|group|gmbh|plc|technologies|solutions|systems|labs|partners|bank|university|hospital)\b\.?/i;
const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic)\b/i;
const DEGREE = /(?<![A-Za-z])(Ph\.?\s?D\.?|Doctor(?:ate)?(?: of [A-Z][a-z]+)?|M\.?B\.?A\.?|Master(?:['’]?s)?(?: of [A-Z][a-z]+| Degree)?|M\.S\.|M\.Sc\.?|MSc|(?<!,\s)MS|(?<!,\s)M\.A\.|Bachelor(?:['’]?s)?(?: of [A-Z][a-z]+| Degree)?|B\.S\.|B\.Sc\.?|BSc|(?<!,\s)BS|B\.A\.|(?<!,\s)BA|Associate(?:['’]?s)?(?: of [A-Z][a-z]+| Degree)?|A\.A\.S?\.?|High School Diploma|GED)(?![a-z])/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?<![\d/-])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/;
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w%-]+\/?/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i;
const WEBSITE = /(?:https?:\/\/\S+|www\.\S+|\b[\w-]+\.(?:com|io|dev|me|net|org|co|ai)(?:\/\S*)?)(?![\w@])/gi;
const CITY_STATE = /([A-Z][A-Za-z.' -]+?),\s*([A-Z]{2})\b(?:\s+(\d{5}(?:-\d{4})?))?/;
const STREET = /\b\d{1,6}\s+[A-Za-z0-9.' -]+?\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|highway|hwy|parkway|pkwy)\b\.?(?:,?\s*(?:apt|unit|suite|ste|#)\s*[\w-]+)?/i;

function toHttps(url: string): string {
  const clean = url.replace(/[).,;]+$/, '').replace(/\/$/, '');
  return /^https?:/i.test(clean) ? clean : `https://${clean}`;
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

function parseDate(raw: string): string {
  const value = raw.trim().toLowerCase();
  const numeric = value.match(/^(\d{1,2})[/-](\d{4})$/);
  if (numeric) return `${numeric[2]}-${numeric[1].padStart(2, '0')}`;
  const year = value.match(/\d{4}/)?.[0] ?? '';
  const month = MONTHS.findIndex((name) => value.startsWith(name));
  return month >= 0 ? `${year}-${String(month + 1).padStart(2, '0')}` : year;
}

function splitSections(lines: string[]) {
  const sections = new Map<Section, string[]>();
  const header: string[] = [];
  const seen: string[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    // Resumes repeat a heading on the next page as "Experience (continued)".
    const key = normalize(line).replace(/\s+(?:continued|contd|cont)$/, '');
    const isOther = OTHER_HEADING.test(key) && key.split(' ').length <= 4 && !/[|,.\d]/.test(line);
    const section = line.length <= 40 ? HEADINGS[key] ?? (isOther ? 'other' : undefined) : undefined;
    if (section) {
      current = section;
      seen.push(key);
      if (!sections.has(section)) sections.set(section, []);
    } else if (current) {
      sections.get(current)!.push(line);
    } else {
      header.push(line);
    }
  }
  return { sections, header, seen };
}

function findName(header: string[]): string {
  for (const line of header.slice(0, 10)) {
    const segment = line.split(/\s*[|•·]\s*|\s{3,}/)[0].trim();
    if (!segment || /[@\d/]/.test(segment) || /resume|curriculum/i.test(segment)) continue;
    const words = segment.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every((word) => /^[\p{L}][\p{L}.'-]*,?$/u.test(word))) {
      const name = segment.replace(/,/g, '');
      return name === name.toUpperCase() ? titleCase(name) : name;
    }
  }
  return '';
}

function splitHeaderSegments(text: string): string[] {
  const strong = text
    .replace(/^[|\s]+|[|\s]+$/g, '')
    .split(/\s{2,}|\s\|\s|\s*[•·]\s*|\s[-–—]\s/)
    .flatMap((part) => (SCHOOL_WORDS.test(part) ? [part] : part.split(/\s+at\s+/)))
    .map((part) => part.trim())
    .filter(Boolean);
  const result: string[] = [];
  for (const part of strong) {
    if (!part.includes(',') || LOCATION.test(part)) {
      result.push(part);
      continue;
    }
    const pieces = part.split(/,\s*/);
    const merged: string[] = [];
    for (const piece of pieces) {
      const previous = merged[merged.length - 1];
      if (previous && /^[A-Z]{2}$/.test(piece)) merged[merged.length - 1] = `${previous}, ${piece}`;
      else if (previous && /^(inc|llc|ltd|corp)\.?$/i.test(piece)) merged[merged.length - 1] = `${previous}, ${piece}`;
      else merged.push(piece);
    }
    result.push(...merged);
  }
  return result
    .map((part) => part.replace(/^[,:;()|\s]+|[,:;()|\s]+$/g, ''))
    .filter(Boolean);
}

function isHeaderLike(line: string): boolean {
  if (!line || BULLET.test(line) || line.length >= 80) return false;
  // A company name can end in a period, as in "Example Technologies Inc."
  return !/[.;]$/.test(line) || /\b(?:inc|corp|ltd|co|llc)\.$/i.test(line);
}

function parseWork(lines: string[], warnings: string[]): WorkEntry[] {
  const clean = lines.filter((line) => line.trim());
  const anchors = clean.flatMap((line, index) => (RANGE.test(line) ? [index] : []));
  if (clean.length && !anchors.length) warnings.push('Found a work section but no date ranges, so no jobs were parsed.');

  const headerStart: number[] = [];
  anchors.forEach((anchor, position) => {
    const floor = position ? anchors[position - 1] + 1 : 0;
    const named = (text: string) => splitHeaderSegments(text).filter((segment) => !LOCATION.test(segment)).length;
    let start = anchor;
    // Stop as soon as title and company are both found, which may take one line or two.
    let found = named(clean[anchor].replace(RANGE, ' ').trim());
    while (start - 1 >= floor && found < 2 && isHeaderLike(clean[start - 1])) found += named(clean[--start]);
    headerStart.push(start);
  });

  return anchors.map((anchor, position) => {
    const match = clean[anchor].match(RANGE)!;
    const segments = [
      ...clean.slice(headerStart[position], anchor).flatMap(splitHeaderSegments),
      ...splitHeaderSegments(clean[anchor].replace(RANGE, ' ').trim()),
    ];
    const limit = position + 1 < anchors.length ? headerStart[position + 1] : clean.length;
    let bodyStart = anchor + 1;
    while (segments.filter((segment) => !LOCATION.test(segment)).length < 2 && bodyStart < limit && isHeaderLike(clean[bodyStart])) {
      segments.push(...splitHeaderSegments(clean[bodyStart]));
      bodyStart++;
    }

    let location = '';
    let title = '';
    let company = '';
    const unknown: string[] = [];
    for (const segment of segments) {
      if (!location && LOCATION.test(segment)) location = segment;
      else if (!company && COMPANY_WORDS.test(segment) && !TITLE_WORDS.test(segment)) company = segment;
      else if (!title && TITLE_WORDS.test(segment)) title = segment;
      else unknown.push(segment);
    }
    if (!company && unknown.length) company = unknown.shift()!;
    if (!title && unknown.length) title = unknown.shift()!;

    // PDF text arrives one visual line at a time, so rejoin sentences that wrapped.
    const descriptionLines: string[] = [];
    for (const line of clean.slice(bodyStart, limit)) {
      const text = line.replace(BULLET, '').trim();
      const previous = descriptionLines[descriptionLines.length - 1];
      if (previous && !BULLET.test(line) && !/[.!?:;]$/.test(previous)) descriptionLines[descriptionLines.length - 1] = `${previous} ${text}`;
      else descriptionLines.push(text);
    }
    const description = descriptionLines.join('\n');
    const endRaw = match[2].toLowerCase();
    const current = /present|current|now|today/.test(endRaw);
    return { company, title, location, start: parseDate(match[1]), end: current ? '' : parseDate(match[2]), current, description };
  });
}

function parseEducation(lines: string[]): EducationEntry[] {
  const clean = lines.filter((line) => line.trim());
  const entries: EducationEntry[] = [];
  const anchors = clean.flatMap((line, index) => (SCHOOL_WORDS.test(line) || DEGREE.test(line) ? [index] : []));

  // A school line and its degree line form one entry, in either order.
  const groups: number[][] = [];
  for (const index of anchors) {
    const group = groups[groups.length - 1];
    const line = clean[index];
    if (group && index - group[group.length - 1] <= 2) {
      const hasSchool = group.some((member) => SCHOOL_WORDS.test(clean[member]));
      const hasDegree = group.some((member) => DEGREE.test(clean[member]));
      if ((SCHOOL_WORDS.test(line) && !hasSchool) || (DEGREE.test(line) && !hasDegree)) {
        group.push(index);
        continue;
      }
    }
    groups.push([index]);
  }

  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const block = clean.slice(first, Math.min(clean.length, last + 2)).join('   ');
    const groupText = group.map((member) => clean[member]).join('   ');
    const degree = groupText.match(DEGREE)?.[0] ?? '';
    let field = '';
    if (degree) {
      const after = groupText.slice(groupText.indexOf(degree) + degree.length);
      field = after.match(/^\s*(?:in|,|-|–|—)\s*([A-Z][A-Za-z&/ ]+?)(?=\s{2,}|,|\s\||\s[-–—]\s|\s\d|$)/)?.[1]?.trim() ?? '';
    }
    const school = group.flatMap((member) => splitHeaderSegments(clean[member])).find((part) => SCHOOL_WORDS.test(part)) ?? '';
    const gpa = block.match(/GPA[:\s]*([0-4]\.\d{1,2})/i)?.[1] ?? '';
    const range = block.match(RANGE);
    const lastYear = [...block.matchAll(/\b(19|20)\d{2}\b/g)].pop()?.[0] ?? '';
    const start = range ? parseDate(range[1]) : '';
    const end = range ? (/present|current|now/i.test(range[2]) ? '' : parseDate(range[2])) : lastYear;
    entries.push({ school, degree, field, gpa, start, end });
  }
  return entries;
}

function parseSkills(lines: string[]): string[] {
  const skills = lines
    .flatMap((line) => line.replace(BULLET, '').replace(/^[A-Za-z &/]{2,30}:\s*/, '').split(/[,;|•·]|\s{3,}/))
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 0 && skill.length <= 40);
  return [...new Set(skills)].slice(0, 80);
}

// Total employed months with overlapping jobs merged, in whole years.
export function yearsOfExperience(work: WorkEntry[], now = new Date()): number {
  const toMonth = (date: string) => {
    const [year, month] = date.split('-').map(Number);
    return year * 12 + (month ? month - 1 : 0);
  };
  const today = now.getFullYear() * 12 + now.getMonth();
  const spans = work
    .filter((job) => job.start)
    .map((job) => [toMonth(job.start), job.current || !job.end ? today : toMonth(job.end)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = -Infinity;
  for (const [start, end] of spans) {
    const from = Math.max(start, cursor);
    if (end > from) total += end - from;
    cursor = Math.max(cursor, end);
  }
  return Math.round(total / 12);
}

export function parseResumeText(text: string, extraWarnings: string[] = []): ParsedResume {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/ /g, ' ').trim());
  const { sections, header, seen } = splitSections(lines);
  const warnings = [...extraWarnings];
  const findings: ParseFinding[] = [];
  const fields: Record<string, string> = {};
  const set = (field: string, value: string | undefined, method: string) => {
    if (value) fields[field] = value;
    findings.push({ field, found: Boolean(value), method: value ? method : 'not found' });
  };

  const contactLines = [...header, ...(sections.get('contact') ?? [])];
  const contactText = contactLines.join('\n');
  const email = text.match(EMAIL)?.[0];
  // Domains further down the page usually belong to employers or side projects.
  const website = [...contactText.matchAll(WEBSITE)]
    .map((match) => match[0])
    .find((url) => !/linkedin\.com|github\.com/i.test(url) && !(email && email.toLowerCase().includes(url.toLowerCase())));

  const name = findName(header);
  const parts = name.split(/\s+/).filter(Boolean);
  set('fullName', name, 'first name-shaped header line');
  set('firstName', parts[0], 'first word of name');
  set('middleName', parts.length > 2 ? parts.slice(1, -1).join(' ') : undefined, 'middle words of name');
  set('lastName', parts.length > 1 ? parts[parts.length - 1] : undefined, 'last word of name');
  set('email', email, 'regex over full text');
  set('phone', text.match(PHONE)?.[0]?.trim(), 'regex over full text');
  const linkedin = text.match(LINKEDIN)?.[0];
  const github = text.match(GITHUB)?.[0];
  set('linkedin', linkedin && toHttps(linkedin), 'regex over full text');
  set('github', github && toHttps(github), 'regex over full text');
  set('website', website && toHttps(website), 'regex over contact lines');

  const cityState = contactLines
    .flatMap((line) => line.split(/\s*[|•·]\s*|\s{3,}/))
    .map((segment) => segment.match(CITY_STATE))
    .find(Boolean);
  const street = contactText.match(STREET)?.[0];
  const city = cityState?.[1]?.replace(street ?? '\u0000', '').replace(/^[,\s]+/, '').trim();
  set('addressLine1', street, 'street pattern in header');
  set('city', city, 'City, ST pattern in header');
  set('state', cityState?.[2], 'City, ST pattern in header');
  set('postalCode', cityState?.[3] ?? contactText.match(/\b\d{5}(?:-\d{4})?\b/)?.[0], 'ZIP pattern in header');
  set('location', city && cityState ? `${city}, ${cityState[2]}` : undefined, 'City, ST pattern in header');
  if (cityState) fields.country = 'United States';

  const summary = (sections.get('summary') ?? []).filter(Boolean).join(' ');
  set('summary', summary, 'summary section');

  const work = parseWork(sections.get('experience') ?? [], warnings);
  const education = parseEducation(sections.get('education') ?? []);
  const skills = parseSkills(sections.get('skills') ?? []);
  findings.push({ field: 'work', found: work.length > 0, method: `${work.length} jobs from date-range anchors` });
  findings.push({ field: 'education', found: education.length > 0, method: `${education.length} entries from school and degree lines` });
  findings.push({ field: 'skills', found: skills.length > 0, method: `${skills.length} items from skills section` });
  for (const [index, job] of work.entries()) {
    if (!job.company || !job.title) warnings.push(`Job ${index + 1} is missing its ${job.company ? 'title' : 'company'}. Check it on the review screen.`);
  }
  if (!sections.size) warnings.push('No section headings were recognized, so work, education and skills are empty.');

  if (work.length) fields.yearsExperience = String(yearsOfExperience(work));

  const profile: Profile = { fields, work, education, skills, updatedAt: Date.now() };
  return { profile, findings, warnings, sections: seen };
}
