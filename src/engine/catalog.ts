// Every piece of data the extension can fill. The matcher, the options form and
// the gap report all read this table, so adding a field means adding one entry.
import type { FieldKind } from '../shared/types';

const TEXT: FieldKind[] = ['text', 'textarea', 'contenteditable'];
const CHOICE: FieldKind[] = ['select', 'combobox', 'radio', 'checkbox'];
const TEXT_OR_CHOICE: FieldKind[] = [...TEXT, ...CHOICE];
const DATE: FieldKind[] = ['text', 'date', 'select', 'combobox'];

export type Group = 'identity' | 'contact' | 'links' | 'work' | 'education' | 'about' | 'answers' | 'demographic' | 'files';
export type Source = 'resume' | 'answer' | 'file';

export interface CatalogEntry {
  key: string;
  label: string;
  group: Group;
  source: Source;
  kinds: FieldKind[];
  phrases: string[];
  autocomplete?: string[];
  negative?: string[];
  // Phrase is specific enough to count inside a long question.
  distinctive?: boolean;
  // Must appear in the section, legend, name or id for the entry to apply.
  context?: RegExp;
  excludeContext?: RegExp;
  sensitive?: boolean;
  allowDuplicates?: boolean;
  repeat?: 'work' | 'education';
  choices?: string[];
  gap?: boolean;
}

const WORK_CONTEXT = /\b(work|employ\w*|experience|job history|previous jobs?|positions? held|career history)\b/i;
const EDU_CONTEXT = /educ|school|university|college|degree|academ/i;
const YES_NO = ['yes', 'no'];
const OTHER_PEOPLE = ['emergency', 'reference', 'referrer', 'referred', 'spouse', 'supervisor', 'manager', 'recruiter', 'guardian', 'relative'];

export const CATALOG: CatalogEntry[] = [
  { key: 'firstName', label: 'First name', group: 'identity', source: 'resume', kinds: TEXT, gap: true, autocomplete: ['given-name'], negative: OTHER_PEOPLE, phrases: ['first name', 'given name', 'forename', 'fname', 'legal first name'] },
  { key: 'middleName', label: 'Middle name', group: 'identity', source: 'resume', kinds: TEXT, autocomplete: ['additional-name'], negative: OTHER_PEOPLE, phrases: ['middle name', 'middle initial'] },
  { key: 'lastName', label: 'Last name', group: 'identity', source: 'resume', kinds: TEXT, gap: true, autocomplete: ['family-name'], negative: OTHER_PEOPLE, phrases: ['last name', 'family name', 'surname', 'lname', 'legal last name'] },
  { key: 'fullName', label: 'Full name', group: 'identity', source: 'resume', kinds: TEXT, autocomplete: ['name'], negative: [...OTHER_PEOPLE, 'company', 'school', 'employer', 'user', 'file', 'first', 'last', 'middle', 'preferred'], phrases: ['full name', 'name', 'legal name', 'candidate name', 'applicant name'] },
  { key: 'preferredName', label: 'Preferred name', group: 'identity', source: 'answer', kinds: TEXT, autocomplete: ['nickname'], phrases: ['preferred name', 'preferred first name', 'nickname'] },
  { key: 'pronouns', label: 'Pronouns', group: 'identity', source: 'answer', kinds: TEXT_OR_CHOICE, phrases: ['pronouns', 'preferred pronouns'], distinctive: true },

  { key: 'email', label: 'Email', group: 'contact', source: 'resume', kinds: TEXT, gap: true, allowDuplicates: true, autocomplete: ['email'], negative: OTHER_PEOPLE, phrases: ['email', 'email address', 'e mail', 'confirm email', 're enter email'] },
  { key: 'phone', label: 'Phone', group: 'contact', source: 'resume', kinds: TEXT, gap: true, autocomplete: ['tel', 'tel-national'], negative: [...OTHER_PEOPLE, 'country code', 'extension', 'phone type', 'device type'], phrases: ['phone', 'phone number', 'mobile', 'mobile phone', 'mobile number', 'cell', 'cell phone', 'telephone', 'contact number'] },
  { key: 'addressLine1', label: 'Street address', group: 'contact', source: 'resume', kinds: [...TEXT, 'combobox'], autocomplete: ['street-address', 'address-line1'], negative: [...OTHER_PEOPLE, 'email', 'web', 'line 2', 'employer'], phrases: ['address', 'street address', 'address line 1', 'address 1', 'street', 'mailing address', 'home address'] },
  { key: 'addressLine2', label: 'Address line 2', group: 'contact', source: 'answer', kinds: TEXT, autocomplete: ['address-line2'], phrases: ['address line 2', 'address 2', 'apartment', 'apt', 'suite', 'unit'] },
  { key: 'city', label: 'City', group: 'contact', source: 'resume', kinds: [...TEXT, 'combobox'], gap: true, autocomplete: ['address-level2'], negative: ['birth', ...OTHER_PEOPLE, 'state'], phrases: ['city', 'town'] },
  { key: 'state', label: 'State or province', group: 'contact', source: 'resume', kinds: [...TEXT, 'select', 'combobox'], gap: true, autocomplete: ['address-level1'], negative: ['birth', ...OTHER_PEOPLE, 'city'], phrases: ['state', 'province', 'state province', 'state or province', 'region'] },
  { key: 'postalCode', label: 'ZIP or postal code', group: 'contact', source: 'resume', kinds: TEXT, gap: true, autocomplete: ['postal-code'], phrases: ['zip', 'zip code', 'postal code', 'postcode', 'zipcode'] },
  { key: 'country', label: 'Country', group: 'contact', source: 'answer', kinds: [...TEXT, 'select', 'combobox'], gap: true, autocomplete: ['country', 'country-name'], negative: ['birth', 'code', 'citizenship'], phrases: ['country', 'country region', 'country of residence'], choices: undefined },
  { key: 'location', label: 'Location (city, state)', group: 'contact', source: 'resume', kinds: [...TEXT, 'combobox'], negative: ['job location', 'preferred', 'office', 'relocat'], phrases: ['location', 'current location', 'city state', 'where are you located', 'location city'] },

  { key: 'linkedin', label: 'LinkedIn URL', group: 'links', source: 'resume', kinds: TEXT, gap: true, distinctive: true, phrases: ['linkedin', 'linkedin url', 'linkedin profile'] },
  { key: 'github', label: 'GitHub URL', group: 'links', source: 'resume', kinds: TEXT, distinctive: true, phrases: ['github', 'github url', 'github profile'] },
  { key: 'portfolio', label: 'Portfolio URL', group: 'links', source: 'resume', kinds: TEXT, phrases: ['portfolio', 'portfolio url', 'portfolio website', 'portfolio link'] },
  { key: 'website', label: 'Personal website', group: 'links', source: 'resume', kinds: TEXT, autocomplete: ['url'], negative: ['linkedin', 'github', 'company'], phrases: ['website', 'personal website', 'personal site', 'blog', 'other website', 'website url'] },

  { key: 'work.company', label: 'Company', group: 'work', source: 'resume', repeat: 'work', kinds: [...TEXT, 'combobox'], autocomplete: ['organization'], negative: ['relative', 'worked for this', 'at this company', 'company size', 'school'], phrases: ['company', 'company name', 'current company', 'employer', 'current employer', 'employer name', 'most recent employer', 'organization'] },
  { key: 'work.title', label: 'Job title', group: 'work', source: 'resume', repeat: 'work', kinds: [...TEXT, 'combobox'], autocomplete: ['organization-title'], negative: ['applying', 'applied', 'degree'], phrases: ['job title', 'title', 'current title', 'position title', 'current job title', 'most recent title', 'role title'] },
  { key: 'work.location', label: 'Job location', group: 'work', source: 'resume', repeat: 'work', kinds: [...TEXT, 'combobox'], context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['location', 'job location', 'work location', 'city'] },
  { key: 'work.start', label: 'Job start date', group: 'work', source: 'resume', repeat: 'work', kinds: DATE, context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['start date', 'from', 'date from', 'employment start date', 'date started', 'from date'] },
  { key: 'work.end', label: 'Job end date', group: 'work', source: 'resume', repeat: 'work', kinds: DATE, context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['end date', 'to', 'date to', 'employment end date', 'date ended', 'to date'] },
  { key: 'work.startMonth', label: 'Job start month', group: 'work', source: 'resume', repeat: 'work', kinds: DATE, context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['start month', 'from month', 'start date month'] },
  { key: 'work.startYear', label: 'Job start year', group: 'work', source: 'resume', repeat: 'work', kinds: DATE, context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['start year', 'from year', 'start date year'] },
  { key: 'work.endMonth', label: 'Job end month', group: 'work', source: 'resume', repeat: 'work', kinds: DATE, context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['end month', 'to month', 'end date month'] },
  { key: 'work.endYear', label: 'Job end year', group: 'work', source: 'resume', repeat: 'work', kinds: DATE, context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['end year', 'to year', 'end date year'] },
  { key: 'work.description', label: 'Job description', group: 'work', source: 'resume', repeat: 'work', kinds: ['textarea', 'contenteditable'], context: WORK_CONTEXT, excludeContext: EDU_CONTEXT, phrases: ['description', 'responsibilities', 'role description', 'job description', 'duties'] },

  { key: 'edu.school', label: 'School', group: 'education', source: 'resume', repeat: 'education', kinds: [...TEXT, 'select', 'combobox'], phrases: ['school', 'school name', 'university', 'college', 'institution', 'school or university', 'college university'] },
  { key: 'edu.degree', label: 'Degree', group: 'education', source: 'resume', repeat: 'education', kinds: [...TEXT, 'select', 'combobox'], phrases: ['degree', 'degree type', 'highest degree', 'level of education', 'education level', 'highest level of education'] },
  { key: 'edu.field', label: 'Field of study', group: 'education', source: 'resume', repeat: 'education', kinds: [...TEXT, 'select', 'combobox'], phrases: ['major', 'field of study', 'discipline', 'area of study', 'concentration'] },
  { key: 'edu.gpa', label: 'GPA', group: 'education', source: 'resume', repeat: 'education', kinds: TEXT, phrases: ['gpa', 'grade point average', 'overall result'] },
  { key: 'edu.start', label: 'School start date', group: 'education', source: 'resume', repeat: 'education', kinds: DATE, context: EDU_CONTEXT, phrases: ['start date', 'from', 'date from', 'start'] },
  { key: 'edu.end', label: 'Graduation date', group: 'education', source: 'resume', repeat: 'education', kinds: DATE, context: EDU_CONTEXT, phrases: ['end date', 'to', 'graduation date', 'date graduated', 'completion date'] },
  { key: 'edu.startYear', label: 'School start year', group: 'education', source: 'resume', repeat: 'education', kinds: DATE, context: EDU_CONTEXT, phrases: ['start year', 'from year', 'start date year'] },
  { key: 'edu.startMonth', label: 'School start month', group: 'education', source: 'resume', repeat: 'education', kinds: DATE, context: EDU_CONTEXT, phrases: ['start month', 'from month', 'start date month'] },
  { key: 'edu.endMonth', label: 'Graduation month', group: 'education', source: 'resume', repeat: 'education', kinds: DATE, context: EDU_CONTEXT, phrases: ['end month', 'to month', 'end date month', 'graduation month'] },
  { key: 'edu.endYear', label: 'Graduation year', group: 'education', source: 'resume', repeat: 'education', kinds: DATE, phrases: ['graduation year', 'year graduated', 'year of graduation', 'end year', 'end date year'], context: EDU_CONTEXT },

  { key: 'summary', label: 'Summary', group: 'about', source: 'resume', kinds: ['textarea', 'contenteditable'], phrases: ['summary', 'professional summary', 'about you', 'about me', 'bio', 'tell us about yourself'] },
  { key: 'skills', label: 'Skills', group: 'about', source: 'resume', kinds: TEXT, phrases: ['skills', 'key skills', 'relevant skills'] },
  { key: 'yearsExperience', label: 'Years of experience', group: 'about', source: 'resume', kinds: TEXT_OR_CHOICE, distinctive: true, phrases: ['years of experience', 'years experience', 'years of relevant experience'], negative: ['with', ' in '] },

  { key: 'workAuthorized', label: 'Authorized to work', group: 'answers', source: 'answer', sensitive: true, gap: true, distinctive: true, allowDuplicates: true, kinds: CHOICE, choices: YES_NO, phrases: ['authorized to work', 'authorised to work', 'work authorization', 'legally authorized', 'eligible to work', 'legally eligible', 'right to work', 'without sponsorship', 'without visa sponsorship', 'without employer sponsorship', 'without any sponsorship', 'without needing sponsorship'] },
  { key: 'sponsorship', label: 'Needs visa sponsorship', group: 'answers', source: 'answer', sensitive: true, gap: true, distinctive: true, allowDuplicates: true, kinds: CHOICE, choices: YES_NO, negative: ['without sponsorship', 'without requiring', 'without the need', 'without visa', 'without employer', 'without any', 'without company', 'without needing'], phrases: ['sponsorship', 'require sponsorship', 'visa sponsorship', 'need sponsorship', 'sponsor'] },
  { key: 'salary', label: 'Desired salary', group: 'answers', source: 'answer', sensitive: true, gap: true, distinctive: true, kinds: TEXT, phrases: ['salary', 'desired salary', 'expected salary', 'compensation expectations', 'desired compensation', 'desired pay', 'expected compensation'] },
  { key: 'relocate', label: 'Willing to relocate', group: 'answers', source: 'answer', distinctive: true, gap: true, allowDuplicates: true, kinds: CHOICE, choices: YES_NO, phrases: ['relocate', 'relocation', 'willing to relocate'] },
  { key: 'availableStart', label: 'Available start date', group: 'answers', source: 'answer', gap: true, distinctive: true, kinds: ['text', 'date', 'textarea'], excludeContext: /educ|employment history|work experience/i, phrases: ['available start', 'earliest start date', 'when can you start', 'availability date', 'date available', 'desired start date', 'earliest you would want to start', 'earliest you can start', 'earliest you could start', 'when could you start', 'when would you like to start'] },
  { key: 'noticePeriod', label: 'Notice period', group: 'answers', source: 'answer', distinctive: true, kinds: TEXT_OR_CHOICE, phrases: ['notice period'] },
  { key: 'howHeard', label: 'How you heard about jobs', group: 'answers', source: 'answer', distinctive: true, kinds: TEXT_OR_CHOICE, phrases: ['how did you hear', 'hear about us', 'hear about this', 'how did you find', 'referral source'] },
  { key: 'over18', label: 'At least 18 years old', group: 'answers', source: 'answer', distinctive: true, gap: true, allowDuplicates: true, kinds: CHOICE, choices: YES_NO, phrases: ['18 years', 'over 18', 'at least 18', 'over age of 18', 'age of 18', '18 or older'] },

  { key: 'gender', label: 'Gender', group: 'demographic', source: 'answer', sensitive: true, gap: true, distinctive: true, kinds: CHOICE, choices: ['Male', 'Female', 'Non-binary', 'decline'], phrases: ['gender', 'gender identity', 'sex'] },
  { key: 'race', label: 'Race or ethnicity', group: 'demographic', source: 'answer', sensitive: true, gap: true, distinctive: true, kinds: CHOICE, choices: ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'decline'], phrases: ['race', 'ethnicity', 'racial', 'race ethnicity'], negative: ['hispanic or latino origin'] },
  { key: 'hispanic', label: 'Hispanic or Latino', group: 'demographic', source: 'answer', sensitive: true, gap: true, distinctive: true, kinds: CHOICE, choices: ['yes', 'no', 'decline'], phrases: ['hispanic', 'latino', 'hispanic or latino'] },
  { key: 'veteran', label: 'Veteran status', group: 'demographic', source: 'answer', sensitive: true, gap: true, distinctive: true, kinds: CHOICE, choices: ['not a veteran', 'veteran', 'decline'], phrases: ['veteran', 'veteran status', 'protected veteran', 'military service'] },
  { key: 'disability', label: 'Disability status', group: 'demographic', source: 'answer', sensitive: true, gap: true, distinctive: true, kinds: CHOICE, choices: ['yes', 'no', 'decline'], phrases: ['disability', 'disability status', 'disabled'] },

  { key: 'resumeUpload', label: 'Resume file', group: 'files', source: 'file', kinds: ['file'], negative: ['cover'], phrases: ['resume', 'cv', 'curriculum vitae', 'resume cv', 'upload resume', 'attach resume', 'upload your resume'], distinctive: true },
  { key: 'coverLetterUpload', label: 'Cover letter file', group: 'files', source: 'file', kinds: ['file'], phrases: ['cover letter', 'coverletter', 'cover'], distinctive: true },
];

export const CATALOG_BY_KEY = new Map(CATALOG.map((entry) => [entry.key, entry]));

export const BLOCKED_PATTERN =
  /\b(ssn|social security|social insurance|date of birth|dob|birth ?date|bank|routing number|account number|credit card|card number|cvv|password|passcode|passport|drivers? licen[sc]e|national id|tax id|maiden name)\b/;

export const GROUP_TITLES: Record<Group, string> = {
  identity: 'Name',
  contact: 'Contact',
  links: 'Links',
  work: 'Work history',
  education: 'Education',
  about: 'About',
  answers: 'Application answers',
  demographic: 'Demographic answers (always flagged for review)',
  files: 'Files',
};
