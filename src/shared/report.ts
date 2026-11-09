// Builds a bug report and sends it to the relay, which files it as a private issue.
// Nothing here reads the profile, the resumes or the answer bank.
import JSZip from 'jszip';
import { redact } from './log';
import { activeModel, providerName } from './providers';
import type { ClaudeSettings, LogEntry } from './types';

export const REPORT_URL = 'https://rote.walker-computers.com/report';
export const MAX_LOG_ENTRIES = 3000;
export const MAX_DESCRIPTION = 5000;

export interface ReportInput {
  description: string;
  contact: string;
  logs: LogEntry[];
  settings: ClaudeSettings;
  version: string;
  browser: string;
}

export interface Report {
  summary: {
    description: string;
    contact: string;
    version: string;
    browser: string;
    host: string;
    ai: { connection: string; provider: string; model: string };
    logEntries: number;
    created: string;
  };
  logLines: string[];
}

// The newest log entry that names a page tells the developer which site the report is about.
function lastHost(logs: LogEntry[]): string {
  for (let index = logs.length - 1; index >= 0; index--) {
    for (const [key, value] of Object.entries(logs[index].data ?? {})) {
      if (typeof value !== 'string' || !/(url|host)$/i.test(key)) continue;
      try {
        return new URL(value).hostname;
      } catch {
        if (/^[\w.-]+$/.test(value)) return value;
      }
    }
  }
  return '';
}

// Entries written while debug logging was on hold personal values, so every entry is redacted again here.
export function buildReport(input: ReportInput): Report {
  const recent = input.logs.slice(-MAX_LOG_ENTRIES);
  const logLines = recent.map((entry) => JSON.stringify({ ...entry, data: redact(entry.data, false) }));
  const off = input.settings.mode === 'off';
  return {
    summary: {
      description: input.description.trim().slice(0, MAX_DESCRIPTION),
      contact: input.contact.trim().slice(0, 200),
      version: input.version,
      browser: input.browser,
      host: lastHost(recent),
      ai: { connection: input.settings.mode, provider: off ? '' : providerName(input.settings), model: off ? '' : activeModel(input.settings) },
      logEntries: logLines.length,
      created: new Date().toISOString(),
    },
    logLines,
  };
}

export function previewText(report: Report): string {
  return `report.json\n${JSON.stringify(report.summary, null, 2)}\n\nlogs.jsonl, ${report.logLines.length} entries, newest first\n${[...report.logLines].reverse().join('\n')}`;
}

export async function zipReport(report: Report): Promise<Blob> {
  const zip = new JSZip();
  zip.file('report.json', JSON.stringify(report.summary, null, 2));
  zip.file('logs.jsonl', report.logLines.join('\n'));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

// Returns the report ID the relay assigned.
export async function sendReport(report: Report): Promise<string> {
  if (!report.summary.description) throw new Error('Describe what went wrong before sending.');
  const form = new FormData();
  form.set('description', report.summary.description);
  form.set('contact', report.summary.contact);
  form.set('version', report.summary.version);
  form.set('browser', report.summary.browser);
  form.set('host', report.summary.host);
  form.set('report', await zipReport(report), 'report.zip');
  let response: Response;
  try {
    response = await fetch(REPORT_URL, { method: 'POST', body: form });
  } catch {
    throw new Error('Could not reach the report server. Check your connection and try again.');
  }
  let body: { id?: string; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // The relay always answers with JSON, so anything else is an outage page.
  }
  if (!response.ok || !body.id) throw new Error(body.error ?? `The report server answered with error ${response.status}.`);
  return body.id;
}
