// The applications page: every page Rote filled, with a status and note the user keeps.
import * as store from '../shared/db';
import { createLogger, errorData } from '../shared/log';
import type { Application, ApplicationStatus } from '../shared/types';
import { byId, h } from './dom';

const log = createLogger('applications');
self.addEventListener('unhandledrejection', (event) => log.error('unhandled', errorData(event.reason)));

const APP_STATUSES: [ApplicationStatus, string][] = [
  ['filled', 'Filled, not sent'], ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn'],
];

let filter: ApplicationStatus | 'all' = 'all';

function renderFilters(apps: Application[]): void {
  const count = (status: ApplicationStatus | 'all') => status === 'all' ? apps.length : apps.filter((app) => app.status === status).length;
  const choices: [ApplicationStatus | 'all', string][] = [['all', 'All'], ...APP_STATUSES];
  byId('app-filters').replaceChildren(...choices
    .filter(([status]) => status === 'all' || status === filter || count(status))
    .map(([status, label]) => h('button', {
      type: 'button', class: 'filter', 'data-status': status, 'aria-pressed': String(status === filter),
      click: () => { filter = status; void render(); },
    }, label, h('span', { class: 'count' }, String(count(status))))));
}

function renderEntry(app: Application): HTMLElement {
  const when = new Date(app.lastFilled).toLocaleDateString();
  const facts = [app.host, `filled ${when}${app.fills > 1 ? `, ${app.fills} times` : ''}`, app.resume && `with ${app.resume}`, app.profile && `profile ${app.profile}`].filter(Boolean).join(', ');
  return h('div', { class: 'entry app', 'data-app': app.id },
    h('div', { class: 'app-title' },
      /^https?:/.test(app.url) ? h('a', { href: app.url, target: '_blank', rel: 'noopener' }, app.title) : h('strong', {}, app.title),
      h('div', { class: 'muted' }, facts)),
    h('label', {}, h('span', {}, 'Status'),
      h('select', { change: async (event: Event) => {
        await store.updateApplication(app.id, { status: (event.target as HTMLSelectElement).value as ApplicationStatus });
        await render();
      } }, ...APP_STATUSES.map(([value, label]) => h('option', { value, selected: value === app.status }, label)))),
    h('label', {}, h('span', {}, 'Note'),
      h('input', { value: app.note, change: (event: Event) => void store.updateApplication(app.id, { note: (event.target as HTMLInputElement).value }) })),
    h('button', { type: 'button', class: 'small', click: async () => {
      if (!confirm(`Delete ${app.title} from your applications?`)) return;
      await store.deleteApplication(app.id);
      await render();
    } }, 'Delete'));
}

async function render(): Promise<void> {
  const apps = await store.listApplications();
  if (filter !== 'all' && !apps.some((app) => app.status === filter)) filter = 'all';
  renderFilters(apps);
  byId<HTMLButtonElement>('apps-export').disabled = !apps.length;
  const shown = filter === 'all' ? apps : apps.filter((app) => app.status === filter);
  byId('apps').replaceChildren(...(shown.length ? shown.map(renderEntry) : [h('p', { class: 'muted empty' }, 'Nothing yet. Fill a form from the side panel and it shows up here.')]));
}

// Page titles come from job sites, and a spreadsheet would run one that starts like a formula.
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

async function exportApplications(): Promise<void> {
  const apps = await store.listApplications();
  const label = new Map(APP_STATUSES);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const lines = [['Last filled', 'First filled', 'Title', 'Site', 'Address', 'Status', 'Resume', 'Profile', 'Times filled', 'Note'],
    ...apps.map((app) => [day(app.lastFilled), day(app.firstFilled), app.title, app.host, app.url, label.get(app.status) ?? app.status, app.resume, app.profile, app.fills, app.note])];
  const blob = new Blob([lines.map((line) => line.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: `rote-applications-${day(Date.now())}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  log.info('applications.exported', { count: apps.length });
}

byId('apps-export').addEventListener('click', exportApplications);
// Fills from the side panel add to the list while this page stays open.
addEventListener('focus', () => void render());
void render();
