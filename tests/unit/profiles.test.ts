import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../../src/shared/types';

async function freshDb() {
  vi.resetModules();
  return import('../../src/shared/db');
}

const profile = (firstName: string): Profile => ({ fields: { firstName }, work: [], education: [], skills: [], updatedAt: 0 });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('profiles', () => {
  it('keeps a profile saved before there were several', async () => {
    const open = indexedDB.open('resume-autofill', 1);
    open.onupgradeneeded = () => {
      const database = open.result;
      database.createObjectStore('kv').put(profile('Jordan'), 'profile');
      database.createObjectStore('resumes', { keyPath: 'id' });
      database.createObjectStore('answers', { keyPath: 'id' });
      database.createObjectStore('logs', { autoIncrement: true });
    };
    await new Promise((resolve) => { open.onsuccess = () => { open.result.close(); resolve(null); }; });

    const db = await freshDb();
    expect((await db.getProfile()).fields.firstName).toBe('Jordan');
    expect(await db.listProfiles()).toEqual([{ id: 'main', name: 'Main profile' }]);
    expect(await db.listApplications()).toEqual([]);
  });

  it('copies, switches, renames and deletes profiles', async () => {
    const db = await freshDb();
    await db.saveProfile(profile('Jordan'));
    const id = await db.createProfile('Support', await db.getProfile());
    expect((await db.getProfile()).fields.firstName).toBe('Jordan');

    await db.setActiveProfile(id);
    await db.saveProfile(profile('Jo'));
    expect((await db.getProfile()).fields.firstName).toBe('Jo');
    expect((await db.getProfile('main')).fields.firstName).toBe('Jordan');

    await db.updateProfileInfo(id, { name: 'Support roles', resumeId: 'r1' });
    expect((await db.activeProfileInfo())).toEqual({ id, name: 'Support roles', resumeId: 'r1' });

    await db.deleteResume('r1');
    expect((await db.activeProfileInfo()).resumeId).toBeUndefined();

    await db.deleteProfile(id);
    expect(await db.activeProfileId()).toBe('main');
    expect((await db.getProfile(id)).updatedAt).toBe(0);
    await expect(db.deleteProfile('main')).rejects.toThrow(/last profile/);
  });
});

describe('application log', () => {
  const seen = { url: 'https://jobs.example.com/acme/apply', host: 'jobs.example.com', title: 'Engineer at Acme', resume: 'cv.pdf', profile: 'Main profile' };

  it('counts refills of the same page and the steps of one form as one application', async () => {
    const db = await freshDb();
    const first = await db.recordApplication(seen, 1000);
    await db.recordApplication(seen, 2000);
    await db.recordApplication({ ...seen, url: 'https://jobs.example.com/acme/apply/step-2' }, 3000);
    const [only, ...rest] = await db.listApplications();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ id: first.id, fills: 3, firstFilled: 1000, lastFilled: 3000, status: 'filled' });
  });

  it('lists a different job on the same site apart, newest first, and keeps status and note', async () => {
    const db = await freshDb();
    const acme = await db.recordApplication(seen, 1000);
    await db.recordApplication({ ...seen, url: 'https://jobs.example.com/globex/apply', title: 'Engineer at Globex' }, 2000);
    await db.recordApplication({ ...seen, url: 'https://jobs.example.com/acme/apply/2' }, 1000 + 7 * 3600000);
    await db.updateApplication(acme.id, { status: 'applied', note: 'Referred by Sam' });
    const apps = await db.listApplications();
    expect(apps.map((app) => app.title)).toEqual(['Engineer at Acme', 'Engineer at Globex', 'Engineer at Acme']);
    expect(apps[2]).toMatchObject({ status: 'applied', note: 'Referred by Sam' });
    await db.deleteApplication(acme.id);
    expect(await db.listApplications()).toHaveLength(2);
  });
});
