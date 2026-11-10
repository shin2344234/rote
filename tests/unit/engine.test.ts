import { describe, expect, it } from 'vitest';
import { parseResumeText, yearsOfExperience } from '../../src/parser/parse';
import { layoutPage, type PdfItem } from '../../src/parser/layout';
import { scoreField, isBlocked, phraseScore, repeatIndex } from '../../src/engine/match';
import { chooseAddress, chooseOption, savedChoices, searchQueries } from '../../src/engine/options';
import { buildPlan, findBankAnswer } from '../../src/engine/plan';
import { canDraft, needsReview, parseReview } from '../../src/engine/review';
import { redact } from '../../src/shared/log';
import type { FieldSignals, PlanRow, Profile, ScannedField } from '../../src/shared/types';

const RESUME = `Jordan Avery
123 Maple Street, Austin, TX 78701 | (512) 555-0147 | jordan.avery@example.com
linkedin.com/in/jordan-avery | github.com/javery | javery.dev

SUMMARY
Backend engineer focused on payments.

PROFESSIONAL EXPERIENCE
Senior Software Engineer, Acme Corp          Jan 2021 - Present
• Built the billing service.
• Led a team of four.
Globex Inc
Software Engineer | Dallas, TX | Mar 2018 - Dec 2020
- Maintained the API.

EDUCATION
University of Texas at Austin
Bachelor of Science in Computer Science, 2014 - 2018, GPA: 3.7

TECHNICAL SKILLS
Languages: TypeScript, Python, SQL
Tools: Docker; Kubernetes
`;

describe('parseResumeText', () => {
  const { profile, warnings } = parseResumeText(RESUME);

  it('reads contact details', () => {
    expect(profile.fields).toMatchObject({
      firstName: 'Jordan', lastName: 'Avery', email: 'jordan.avery@example.com', phone: '(512) 555-0147',
      city: 'Austin', state: 'TX', postalCode: '78701', addressLine1: '123 Maple Street',
      linkedin: 'https://linkedin.com/in/jordan-avery', github: 'https://github.com/javery', website: 'https://javery.dev',
    });
  });

  it('reads two differently formatted jobs', () => {
    expect(profile.work).toHaveLength(2);
    expect(profile.work[0]).toMatchObject({ title: 'Senior Software Engineer', company: 'Acme Corp', start: '2021-01', current: true, end: '' });
    expect(profile.work[0].description).toBe('Built the billing service.\nLed a team of four.');
    expect(profile.work[1]).toMatchObject({ title: 'Software Engineer', company: 'Globex Inc', location: 'Dallas, TX', start: '2018-03', end: '2020-12' });
  });

  it('reads education and skills', () => {
    expect(profile.education[0]).toMatchObject({ school: 'University of Texas at Austin', degree: 'Bachelor of Science', field: 'Computer Science', gpa: '3.7', start: '2014', end: '2018' });
    expect(profile.skills).toEqual(['TypeScript', 'Python', 'SQL', 'Docker', 'Kubernetes']);
    expect(warnings).toEqual([]);
  });

  it('handles a period after Inc., a continued heading, wrapped bullets and later project sections', () => {
    const { profile: parsed, warnings: notes } = parseResumeText(`Jordan Avery

PROFESSIONAL EXPERIENCE
IT Director | Example Studios
Houston, TX | 2023 - 2026
Managed internal IT for many employees and vendor
relationships.
• Built onboarding automation that reduced turnaround from three days to four
hours for new hires.
Technical Lead | Sample Technologies Inc.
Austin, TX | 2019 - 2023
• Led a team of technicians.

PROFESSIONAL EXPERIENCE (CONTINUED)
Support Lead | Harbor Bogard
Saint Louis, MO | 2017 - 2019
• Migrated users to a new mail system.

SELECTED PROJECTS
Storage migration: Moved a cluster to new storage.
`);
    expect(parsed.work.map(({ title, company, location }) => [title, company, location])).toEqual([
      ['IT Director', 'Example Studios', 'Houston, TX'],
      ['Technical Lead', 'Sample Technologies Inc.', 'Austin, TX'],
      ['Support Lead', 'Harbor Bogard', 'Saint Louis, MO'],
    ]);
    expect(parsed.work[0].description).toBe('Managed internal IT for many employees and vendor relationships.\nBuilt onboarding automation that reduced turnaround from three days to four hours for new hires.');
    expect(parsed.work[2].description).toBe('Migrated users to a new mail system.');
    expect(notes).toEqual([]);
  });

  it('only takes the website from the contact lines', () => {
    const body = '\nSUMMARY\nBuilt things.\n\nPROJECTS\nSample App | sampleapp.com\n';
    expect(parseResumeText(`Jordan Avery\njordan@avery-computers.com${body}`).profile.fields.website).toBeUndefined();
    expect(parseResumeText(`Jordan Avery\njavery.dev${body}`).profile.fields.website).toBe('https://javery.dev');
  });

  it('warns when no sections exist', () => {
    expect(parseResumeText('just some words').warnings.join()).toMatch(/No section headings/);
  });

  it('merges overlapping jobs when counting years', () => {
    const job = (start: string, end: string) => ({ company: '', title: '', location: '', start, end, current: false, description: '' });
    expect(yearsOfExperience([job('2018-01', '2020-01'), job('2019-01', '2021-01')])).toBe(3);
  });
});

describe('layoutPage', () => {
  const item = (str: string, x: number, y: number, width = 100): PdfItem => ({ str, x, y, width, height: 10 });

  it('reads two columns one after the other', () => {
    const items = [0, 1, 2, 3, 4, 5].flatMap((row) => [item(`L${row}`, 50, 700 - row * 14), item(`R${row}`, 350, 700 - row * 14)]);
    const { text, columns } = layoutPage(items);
    expect(columns).toBe(2);
    expect(text.split(/\n+/)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
  });

  it('keeps a single column with right-aligned dates on one line', () => {
    const items = [
      item('Engineer, Acme', 50, 700), item('2020 - 2021', 450, 700),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((row) => item('A long bullet that runs across the page width', 50, 700 - row * 14, 480)),
    ];
    const { text, columns } = layoutPage(items);
    expect(columns).toBe(1);
    expect(text.split('\n')[0]).toBe('Engineer, Acme   2020 - 2021');
  });
});

function field(signals: Partial<FieldSignals>, extra: Partial<ScannedField> = {}): ScannedField {
  return {
    fieldId: 'f', frameId: 0, frameUrl: 'https://x.test/', kind: 'text', tag: 'input', role: '', domPath: '', required: false, hasValue: false, options: [], accept: '', dropzone: false,
    signals: { label: '', ariaLabel: '', legend: '', nearby: '', section: '', name: '', id: '', automationId: '', placeholder: '', autocomplete: '', inputType: 'text', ...signals },
    ...extra,
  };
}
const top = (input: ScannedField) => scoreField(input)[0]?.key;

describe('field matching', () => {
  it.each([
    [{ label: 'First Name' }, 'firstName'],
    [{ name: 'job_application[last_name]' }, 'lastName'],
    [{ name: 'firstname' }, 'firstName'],
    [{ label: 'Name' }, 'fullName'],
    [{ label: 'Company Name' }, 'work.company'],
    [{ autocomplete: 'section-a email' }, 'email'],
    [{ label: 'LinkedIn Profile URL' }, 'linkedin'],
    [{ placeholder: 'ZIP code' }, 'postalCode'],
    [{ label: 'Start Date', section: 'Work Experience' }, 'work.start'],
    [{ label: 'Start Date', section: 'Education' }, 'edu.start'],
    [{ label: 'City', section: 'Work Experience' }, 'work.location'],
    [{ label: 'City', section: 'Personal Information' }, 'city'],
  ])('%j becomes %s', (signals, key) => expect(top(field(signals))).toBe(key));

  it('separates education month and year fields from job ones', () => {
    const month = (section: string) => field({ label: 'Start date month', section }, { kind: 'combobox' });
    expect(top(month('Education'))).toBe('edu.startMonth');
    expect(top(month('Employment'))).toBe('work.startMonth');
    expect(top(field({ label: 'End date month', section: 'Education' }, { kind: 'combobox' }))).toBe('edu.endMonth');
    expect(top(field({ label: 'End date year', section: 'Education', inputType: 'number' }))).toBe('edu.endYear');
  });

  it('recognizes long yes/no questions', () => {
    const question = (legend: string) => field({ legend }, { kind: 'radio', options: ['Yes', 'No'] });
    expect(top(question('Are you legally authorized to work in the United States?'))).toBe('workAuthorized');
    expect(top(question('Will you now or in the future require visa sponsorship?'))).toBe('sponsorship');
    expect(top(question('Can you work in the US without sponsorship?'))).toBe('workAuthorized');
  });

  it('never puts a yes/no answer into a free-text box', () => {
    const score = scoreField(field({ label: 'What address will you work from? If you would need to relocate, give the new one.' }));
    expect(score.filter((candidate) => candidate.score >= 0.6)).toEqual([]);
    expect(score.map((candidate) => candidate.key)).not.toContain('relocate');
  });

  it('recognizes an earliest start question', () => {
    expect(top(field({ label: 'When is the earliest you would want to start working with us?' }))).toBe('availableStart');
  });

  it('does not treat a stray word in a sentence as the field', () => {
    const score = scoreField(field({ label: 'Do you have a relative working at this company or a related employer group' }));
    expect(score.filter((candidate) => candidate.score >= 0.6)).toEqual([]);
  });

  it('keeps other people out of identity fields', () => {
    expect(top(field({ label: 'Emergency contact name' }))).toBeUndefined();
    expect(top(field({ label: 'Reference phone number' }))).toBeUndefined();
  });

  it('blocks identifiers', () => {
    for (const signals of [{ label: 'Social Security Number' }, { name: 'dob' }, { label: 'Date of Birth' }, { inputType: 'password' }]) {
      expect(isBlocked(field(signals))).toBe(true);
    }
    expect(isBlocked(field({ label: 'Email' }))).toBe(false);
  });

  it('matches squashed identifiers only as whole tokens', () => {
    expect(phraseScore('emailaddress', 'email address')).toBeGreaterThan(0.9);
    expect(phraseScore('unitedstates', 'state')).toBe(0);
  });
});

describe('chooseOption', () => {
  it.each([
    ['state', 'TX', ['Select', 'California', 'Texas'], 2],
    ['state', 'Texas', ['CA', 'TX'], 1],
    ['country', 'United States', ['Canada', 'USA'], 1],
    ['workAuthorized', 'yes', ['Please select', 'Yes, I am authorized', 'No'], 1],
    ['sponsorship', 'no', ['Yes', 'No, I will not'], 1],
    ['gender', 'Male', ['Female', 'Male', 'Decline'], 1],
    ['gender', 'decline', ['Female', 'Male', "I don't wish to answer"], 2],
    ['veteran', 'not a veteran', ['I identify as a protected veteran', 'I am not a protected veteran'], 1],
    ['edu.degree', 'Bachelor of Science', ['High School', "Bachelor's Degree", "Master's Degree"], 1],
    ['work.startMonth', 'March', ['Jan', 'Feb', 'Mar'], 2],
    ['work.startMonth', 'March', ['01', '02', '03'], 2],
  ])('%s=%s', (key, value, options, index) => expect(chooseOption(key, value, options)?.index).toBe(index));

  const campuses = ['University of Texas - Arlington', 'University of Texas - Austin', 'University of Texas - Dallas'];

  it('picks the right campus and never guesses one', () => {
    expect(chooseOption('edu.school', 'University of Texas at Austin', campuses)?.index).toBe(1);
    expect(chooseOption('edu.school', 'University of Texas', campuses)).toBeNull();
    expect(chooseOption('edu.school', 'University of Texas at Tyler', campuses)).toBeNull();
  });

  it('shortens a search without ending on a filler word', () => {
    expect(searchQueries('University of Texas at Austin')).toEqual(['University of Texas at Austin', 'University of Texas', 'University']);
    expect(searchQueries('Bachelor of Science')).toEqual(['Bachelor of Science', 'Bachelor']);
    expect(searchQueries('Texas')).toEqual(['Texas']);
  });

  it('does not confuse male with female', () => {
    expect(chooseOption('gender', 'Male', ['Female', 'Other'])).toBeNull();
  });
});

describe('buildPlan', () => {
  const profile: Profile = {
    fields: { firstName: 'Jordan', email: 'j@example.com', workAuthorized: 'yes' },
    work: [{ company: 'Acme', title: 'Dev', location: '', start: '2021-03', end: '', current: true, description: '' }, { company: 'Globex', title: 'QA', location: '', start: '2019-01', end: '2020-02', current: false, description: '' }],
    education: [], skills: [], updatedAt: 1,
  };
  const plan = (fields: ScannedField[]) => buildPlan(fields.map((item, index) => ({ ...item, fieldId: `f${index}` })), { profile, bank: [] });

  it('assigns statuses', () => {
    const rows = plan([
      field({ label: 'First Name' }),
      field({ label: 'Last Name' }),
      field({ label: 'Email' }, { hasValue: true }),
      field({ label: 'SSN' }),
      field({ legend: 'Are you authorized to work here?' }, { kind: 'radio', options: ['Yes', 'No'] }),
      field({ label: 'Favorite color' }),
    ]);
    expect(rows.map((row) => row.status)).toEqual(['ready', 'missing', 'existing', 'blocked', 'confirm', 'unmatched']);
  });

  it('shifts 1-based repeating rows to the first job', () => {
    const rows = plan([
      field({ name: 'workExperience-1--company', label: 'Company' }),
      field({ name: 'workExperience-2--company', label: 'Company' }),
    ]);
    expect(rows.map((row) => row.value)).toEqual(['Acme', 'Globex']);
  });

  it('formats dates to the control', () => {
    const value = (signals: Partial<FieldSignals>, kind: ScannedField['kind'] = 'text') => plan([field({ section: 'Work Experience', label: 'Start Date', ...signals }, { kind })])[0].value;
    expect(value({})).toBe('03/2021');
    expect(value({ placeholder: 'YYYY-MM' })).toBe('2021-03');
    expect(value({ inputType: 'date' }, 'date')).toBe('2021-03-01');
  });

  it('lets two email fields both fill but only one first name', () => {
    const rows = plan([field({ label: 'Email' }), field({ label: 'Confirm email' }), field({ label: 'First Name' }), field({ placeholder: 'First name' })]);
    expect(rows.map((row) => row.status)).toEqual(['ready', 'ready', 'ready', 'unmatched']);
  });

  it('answers every differently worded yes/no question and clears the key on a duplicate loser', () => {
    const question = (legend: string) => field({ legend }, { kind: 'radio', options: ['Yes', 'No'] });
    const rows = plan([question('Are you authorized to work here?'), question('Are you legally authorized to work in this country?')]);
    expect(rows.map((row) => row.status)).toEqual(['confirm', 'confirm']);
    const names = plan([field({ label: 'First Name' }), field({ placeholder: 'First name' })]);
    expect(names[1]).toMatchObject({ status: 'unmatched', key: '', keyLabel: '' });
  });

  it('fills a legal name question even after the plain name field', () => {
    const rows = plan([field({ label: 'First Name' }), field({ label: 'What is your legal first name?' })]);
    expect(rows.map((row) => [row.key, row.status])).toEqual([['firstName', 'ready'], ['firstName', 'ready']]);
  });

  it('ticks a single current role box only for the current job', () => {
    const box = (name: string) => field({ name, id: `${name}_1`, label: 'Current role', section: 'Employment' }, { kind: 'checkbox', options: ['Current role'] });
    const rows = plan([box('current-role-0'), box('current-role-1')]);
    expect(rows.map((row) => row.key)).toEqual(['work.current', 'work.current']);
    expect(rows.map((row) => [row.value, row.status])).toEqual([['Current role', 'ready'], ['', 'missing']]);
  });

  it('finds answer bank entries by similar wording', () => {
    const bank = [{ id: '1', question: 'q', normalized: 'why do you want to work here', answer: 'a', updatedAt: 0 }];
    expect(findBankAnswer('Why do you want to work here?', bank)?.answer).toBe('a');
    expect(findBankAnswer('Why are you leaving your job?', bank)).toBeUndefined();
  });
});

describe('redact', () => {
  it('removes personal values and URL queries by default', () => {
    expect(redact({ value: 'secret', key: 'email', frameUrl: 'https://a.test/x?token=1' }, false)).toEqual({ value: { redacted: 'string', length: 6 }, key: 'email', frameUrl: 'https://a.test/x' });
  });
  it('keeps values in debug mode', () => {
    expect(redact({ value: 'secret' }, true)).toEqual({ value: 'secret' });
  });
});

describe('address suggestions', () => {
  const place = { city: 'Austin', state: 'TX', postalCode: '78701' };

  it('matches abbreviated street words and skips other towns', () => {
    expect(chooseAddress('123 Maple Street', ['123 Maple St, Dallas TX 75201', '123 Maple St, Austin TX 78701'], place)).toEqual({ index: 1, score: 0.9 });
    expect(chooseAddress('500 W Oak Avenue', ['500 West Oak Ave, Austin, Texas'], place)?.index).toBe(0);
  });

  it('picks nothing for another house number, another town, or an unknown place', () => {
    expect(chooseAddress('123 Maple Street', ['1230 Maple St, Austin TX 78701'], place)).toBeNull();
    expect(chooseAddress('123 Maple Street', ['123 Maple St, Austin AR 72001'], place)).toBeNull();
    expect(chooseAddress('123 Maple Street', ['123 Maple St, Austin TX 78701'], {})).toBeNull();
  });
});

describe('drafting offers', () => {
  const field = { hasValue: false, options: [] } as unknown as ScannedField;
  const row = (label: string, kind: string, status: string, claude?: object) => ({ label, kind, status, claude }) as unknown as PlanRow;

  it('offers a draft on open-ended questions only', () => {
    expect(canDraft(row('Why do you want this job?', 'textarea', 'unmatched'), field)).toBe(true);
    expect(canDraft(row('Cover letter', 'textarea', 'missing'), field)).toBe(true);
    expect(canDraft(row('What motivates you', 'text', 'unmatched'), field)).toBe(true);
    expect(canDraft(row('Company website', 'text', 'unmatched'), field)).toBe(false);
    expect(canDraft(row('Zip code', 'text', 'missing'), field)).toBe(false);
    expect(canDraft(row('Social Security Number?', 'text', 'blocked'), field)).toBe(false);
    expect(canDraft(row('Are you willing to relocate?', 'radio', 'unmatched'), { ...field, options: ['Yes', 'No'] })).toBe(false);
  });

  it('skips answered fields but survives a strict review that found nothing', () => {
    const question = 'Why do you want this job?';
    expect(canDraft(row(question, 'textarea', 'unmatched'), { ...field, hasValue: true })).toBe(false);
    expect(canDraft(row(question, 'textarea', 'unmatched', { state: 'unanswered' }), field)).toBe(true);
    expect(canDraft(row(question, 'textarea', 'unmatched', { state: 'unanswered', drafted: true }), field)).toBe(false);
    expect(canDraft(row(question, 'textarea', 'confirm', { state: 'asking' }), field)).toBe(false);
  });
});

describe('code review regressions', () => {
  const yesNo: Partial<ScannedField> = { kind: 'radio', options: ['Yes', 'No'] };

  it('treats working without visa sponsorship as work authorization', () => {
    const question = 'Can you work in the United States without visa sponsorship?';
    expect(scoreField(field({ label: question }, yesNo))[0].key).toBe('workAuthorized');
    expect(scoreField(field({ legend: question }, yesNo))[0].key).toBe('workAuthorized');
    expect(scoreField(field({ legend: 'Will you require visa sponsorship?' }, yesNo))[0].key).toBe('sponsorship');
  });

  it('matches age questions that name a number', () => {
    for (const label of ['Are you at least 18 years old?', 'Are you over the age of 18?', 'Are you 18 or older?']) {
      expect(scoreField(field({ label }, yesNo))[0]?.key).toBe('over18');
    }
  });

  it('ignores form builder ids when numbering repeated sections', () => {
    expect(repeatIndex(field({ id: 'input-12' }))).toBeNull();
    expect(repeatIndex(field({ name: 'question_3' }))).toBeNull();
    expect(repeatIndex(field({ name: 'educations[0]' }))).toBe(0);
    expect(repeatIndex(field({ id: 'workExperience-2--title' }))).toBe(2);
  });

  it('keeps options apart when only a symbol differs', () => {
    const options = ['C#', 'C++', 'Java'];
    expect(chooseOption('skill', 'C++', options)?.index).toBe(1);
    const question = { id: 'a', label: 'Language', kind: 'select', required: false, options } as const;
    const reply = (answer: string) => ({ answers: [{ id: 'a', answer, confidence: 'high', basis: '' }] });
    expect(parseReview(reply('C++'), [{ ...question, options }])[0].answer).toBe('C++');
    expect(parseReview(reply('c'), [{ ...question, options }])).toEqual([]);
    expect(parseReview(reply('C++'), [{ ...question, options: ['C#', 'Java'] }])).toEqual([]);
  });

  it('finds each label in a saved list of choices', () => {
    const options = ['Monday', 'Tuesday', 'Friday, if remote', 'Friday'];
    expect(savedChoices('Monday, Friday, if remote', options)).toEqual([0, 2]);
    expect(savedChoices('monday , tuesday', options)).toEqual([0, 1]);
    expect(savedChoices('Monday, Sunday, Tuesday', options)).toEqual([0, 1]);
    expect(savedChoices('Sunday', options)).toEqual([]);
    expect(savedChoices('Yes, I am authorized', ['Yes', 'No'])).toEqual([0]);
    expect(savedChoices('Select one, Yes', ['Select one', 'Yes'])).toEqual([1]);
    expect(savedChoices('', options)).toEqual([]);
  });

  it('takes several options from Claude only on a question that allows them', () => {
    const multi = { id: 'a', label: 'Teams', kind: 'select', required: false, options: ['Platform', 'Security', 'Data, Analytics'], multiple: true };
    const reply = (answer: string) => ({ answers: [{ id: 'a', answer, confidence: 'high', basis: 'x' }] });
    expect(parseReview(reply('Platform, Data, Analytics'), [multi])[0].answer).toBe('Platform, Data, Analytics');
    expect(parseReview(reply('Security, Made Up'), [multi])[0].answer).toBe('Security');
    expect(parseReview(reply('Made Up, Invented'), [multi])).toEqual([]);
    const similar = { ...multi, options: ['Research & Development', 'Research', 'Development'] };
    expect(parseReview(reply('Research, Development'), [similar])[0].answer).toBe('Research, Development');
    expect(parseReview(reply('Platform, Security'), [{ ...multi, multiple: false }])).toEqual([]);
  });

  it('never swaps one symbol name for another',() => {
    expect(chooseOption('skill', 'C++', ['C#', 'Java'])).toBeNull();
    expect(chooseOption('skill', 'C', ['C#', 'Java'])).toBeNull();
    expect(chooseOption('grade', 'A+', ['A', 'B'])).toBeNull();
    expect(chooseOption('skill', 'C++', ['C++ or Java', 'Go'])?.index).toBe(0);
    expect(chooseOption('skill', 'yes', ['Yes, including C++', 'No'])?.index).toBe(0);
    expect(chooseOption('skill', 'C', ['C#, Java', 'Go'])).toBeNull();
    expect(chooseOption('skill', 'Notepad', ['Notepad++', 'Vim'])).toBeNull();
    expect(chooseOption('skill', 'C', ['C, C++', 'Go'])?.index).toBe(0);
    expect(chooseOption('skill', 'Java', ['C#, Java', 'Go'])?.index).toBe(0);
  });

  it('redacts dropdown suggestions', () => {
    expect(JSON.stringify(redact({ suggestions: ['123 Maple St, Austin TX'] }, false))).not.toContain('Maple');
  });
});

describe('Claude review', () => {
  const question = (id: string, options: string[] = []) => ({ id, label: id, kind: 'text', required: false, options });

  it('keeps supported answers and maps option text to the page spelling', () => {
    const answers = parseReview({ answers: [
      { id: 'a', answer: ' Ten years ', confidence: 'high', basis: 'Work history' },
      { id: 'b', answer: 'yes', confidence: 'medium', basis: 'Stated' },
    ] }, [question('a'), question('b', ['Yes', 'No'])]);
    expect(answers.map((answer) => answer.answer)).toEqual(['Ten years', 'Yes']);
  });

  it('drops null answers, unknown ids and text that is not one of the options', () => {
    expect(parseReview({ answers: [
      { id: 'a', answer: null, confidence: 'low', basis: '' },
      { id: 'other', answer: 'x', confidence: 'low', basis: '' },
      { id: 'c', answer: 'Maybe', confidence: 'high', basis: '' },
    ] }, [question('a'), question('c', ['Yes', 'No'])])).toEqual([]);
  });

  it('rejects a reply in the wrong shape', () => {
    expect(() => parseReview('nope', [question('a')])).toThrow();
  });

  it('never selects blocked, file, consent or already answered fields', () => {
    const row = { fieldId: 'f', frameId: 0, kind: 'text', status: 'unmatched' } as PlanRow;
    const field = { hasValue: false, options: [] } as unknown as ScannedField;
    expect(needsReview(row, field)).toBe(true);
    expect(needsReview({ ...row, status: 'blocked' }, field)).toBe(false);
    expect(needsReview({ ...row, kind: 'file' }, field)).toBe(false);
    expect(needsReview({ ...row, kind: 'checkbox' }, { ...field, options: ['I certify this is true'] })).toBe(false);
    expect(needsReview(row, { ...field, hasValue: true })).toBe(false);
    expect(needsReview({ ...row, status: 'ready', result: { fieldId: 'f', ok: false, detail: '' } }, field)).toBe(true);
  });
});
