export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'combobox'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'file'
  | 'contenteditable';

export interface FieldSignals {
  label: string;
  ariaLabel: string;
  legend: string;
  nearby: string;
  section: string;
  name: string;
  id: string;
  automationId: string;
  placeholder: string;
  autocomplete: string;
  inputType: string;
}

export interface ScannedField {
  fieldId: string;
  frameId: number;
  frameUrl: string;
  kind: FieldKind;
  tag: string;
  role: string;
  domPath: string;
  required: boolean;
  hasValue: boolean;
  options: string[];
  multiple?: boolean;
  accept: string;
  dropzone: boolean;
  signals: FieldSignals;
}

export interface WorkEntry {
  company: string;
  title: string;
  location: string;
  start: string; // YYYY-MM or YYYY
  end: string; // YYYY-MM, YYYY or empty when current
  current: boolean;
  description: string;
}

export interface EducationEntry {
  school: string;
  degree: string;
  field: string;
  gpa: string;
  start: string;
  end: string;
}

export interface Profile {
  fields: Record<string, string>;
  work: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  updatedAt: number;
}

export interface ParseFinding {
  field: string;
  found: boolean;
  method: string;
}

export interface ParsedResume {
  profile: Profile;
  findings: ParseFinding[];
  warnings: string[];
  sections: string[];
}

export interface StoredResume {
  id: string;
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
  addedAt: number;
  isDefault: boolean;
}

export interface BankAnswer {
  id: string;
  question: string;
  normalized: string;
  answer: string;
  updatedAt: number;
}

export type RowStatus =
  | 'ready' // Confident match with a value.
  | 'low' // Probable match; fill and flag.
  | 'confirm' // Sensitive answer; fill and require confirmation.
  | 'existing' // Page already has a value; left alone.
  | 'missing' // Matched, but the profile has no value.
  | 'no-option' // Matched, but no choice on the page fits the value.
  | 'suggested' // Answer bank has a likely answer; applied only on request.
  | 'unmatched' // Nothing recognized this field.
  | 'blocked'; // Never filled, such as SSN or password.

export interface Candidate {
  key: string;
  score: number;
}

export interface PlanRow {
  fieldId: string;
  frameId: number;
  frameHost: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  key: string;
  keyLabel: string;
  index: number;
  score: number;
  status: RowStatus;
  value: string;
  reason: string;
  candidates: Candidate[];
  result?: FillResult;
  confirmed?: boolean;
  claude?: ClaudeReview;
  place?: AddressPlace;
}

export interface AddressPlace {
  city?: string;
  state?: string;
  postalCode?: string;
}

// 'openai' covers every other provider and local server, since they all accept the OpenAI chat format.
// 'codex-api' is the OpenAI preset under its own name, and 'codex' runs the Codex CLI through the local bridge.
export type ClaudeMode = 'off' | 'api' | 'bridge' | 'codex-api' | 'codex' | 'openai';

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ClaudeSettings {
  mode: ClaudeMode;
  apiKey: string;
  model: string;
  provider?: string;
  providers?: Record<string, ProviderConfig>;
}

export type ReviewConfidence = 'high' | 'medium' | 'low';

export interface ClaudeReview {
  state: 'asking' | 'done' | 'unanswered';
  confidence: ReviewConfidence;
  basis: string;
  edit: string;
  options: string[];
  before: Pick<PlanRow, 'status' | 'value' | 'reason'>;
  drafted?: boolean;
}

export interface FillItem {
  fieldId: string;
  key: string;
  kind: FieldKind;
  value: string;
  mark: 'ok' | 'low' | 'confirm';
  overwrite: boolean;
  place?: AddressPlace;
}

export interface FillResult {
  fieldId: string;
  ok: boolean;
  detail: string;
  chosen?: string;
}

export interface FilePayload {
  id: string;
  name: string;
  type: string;
  base64: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  event: string;
  runId?: string;
  data?: Record<string, unknown>;
}

export type ContentRequest =
  | { type: 'scan'; runId: string; frameId: number }
  | { type: 'fill'; runId: string; items: FillItem[] }
  | { type: 'upload'; runId: string; fieldId: string; file: FilePayload; mark: 'ok' | 'low' }
  | { type: 'uploaded'; runId: string }
  | { type: 'settle'; runId: string }
  | { type: 'undo'; runId: string }
  | { type: 'check'; runId: string; fields: { fieldId: string; chosen?: string }[] }
  | { type: 'read'; runId: string; fieldId: string }
  | { type: 'show'; runId: string; fieldId: string };
