import { describe, expect, it } from 'vitest';
import { EMPTY_RULES } from './library.ts';
import { Intake } from './scan/intake.ts';
import { tempSpace } from './test-helpers.ts';

describe('JobStore', () => {
  it('moves jobs with a reason, logs it, and restores to the last list', () => {
    const { jobs } = tempSpace();
    const job = jobs.insert({
      url: 'https://x.org/1',
      company: 'Acme',
      role: 'Grants Manager',
      source: 'test',
      list: 'inbox',
      movedBy: 'scan',
      addedBy: 'scan',
    });
    jobs.move({ ids: [job.id], to: 'shortlist' }, 'you');
    const archived = jobs.move(
      { ids: [job.id], to: 'archive', reason: 'not_for_me', detail: 'Too far' },
      'you',
    )[0];
    expect(archived).toMatchObject({
      list: 'archive',
      archiveReason: 'not_for_me',
      archiveDetail: 'Too far',
      prevList: 'shortlist',
      movedBy: 'you',
    });
    const restored = jobs.restore([job.id])[0];
    expect(restored).toMatchObject({ list: 'shortlist', archiveReason: null });
    expect(jobs.detail(job.id).timeline.map((t) => t.text)).toEqual([
      'Found by test',
      'You moved it to Shortlist',
      'You archived it: Too far',
      'You restored it to Shortlist',
    ]);
  });

  it('refuses to archive without a reason', () => {
    const { jobs } = tempSpace();
    const job = jobs.insert({
      url: 'https://x.org/2',
      company: 'A',
      role: 'R',
      source: 't',
      list: 'inbox',
      movedBy: 'scan',
      addedBy: 'scan',
    });
    expect(() => jobs.move({ ids: [job.id], to: 'archive' }, 'you')).toThrow(/reason/);
  });

  it('pages stably with a cursor and counts the whole list', () => {
    const { jobs } = tempSpace();
    for (let i = 0; i < 7; i++)
      jobs.insert({
        url: `https://x.org/p${i}`,
        company: `C${i}`,
        role: 'Role',
        source: 't',
        list: 'inbox',
        movedBy: 'scan',
        addedBy: 'scan',
        postedAt: `2026-10-1${i}`,
      });
    const first = jobs.query({ list: 'inbox', limit: 3 });
    expect(first.total).toBe(7);
    expect(first.items.map((j) => j.company)).toEqual(['C6', 'C5', 'C4']);
    const second = jobs.query({ list: 'inbox', limit: 3, cursor: first.nextCursor ?? undefined });
    expect(second.items.map((j) => j.company)).toEqual(['C3', 'C2', 'C1']);
    const third = jobs.query({ list: 'inbox', limit: 3, cursor: second.nextCursor ?? undefined });
    expect(third.items.map((j) => j.company)).toEqual(['C0']);
    expect(third.nextCursor).toBeNull();
  });

  it('filters the inbox by triage verdict', () => {
    const { jobs } = tempSpace();
    const a = jobs.insert({
      url: 'https://x.org/t1',
      company: 'A',
      role: 'R',
      source: 't',
      list: 'inbox',
      movedBy: 'scan',
      addedBy: 'scan',
    });
    jobs.insert({
      url: 'https://x.org/t2',
      company: 'B',
      role: 'R',
      source: 't',
      list: 'inbox',
      movedBy: 'scan',
      addedBy: 'scan',
    });
    jobs.setTriage(a.id, {
      verdict: 'keep',
      reason: 'Fits',
      at: new Date().toISOString(),
      runId: null,
    });
    expect(jobs.query({ list: 'inbox', triage: 'keep' }).items.map((j) => j.company)).toEqual([
      'A',
    ]);
    expect(jobs.query({ list: 'inbox', triage: 'none' }).items.map((j) => j.company)).toEqual([
      'B',
    ]);
    expect(jobs.counts().kept).toBe(1);
    expect(jobs.keptInInbox()).toEqual([a.id]);
    jobs.move({ ids: jobs.keptInInbox(), to: 'shortlist' }, 'you');
    expect(jobs.counts()).toMatchObject({ inbox: 1, shortlist: 1, kept: 0 });
  });
});

describe('Intake', () => {
  const rules = {
    ...EMPTY_RULES,
    title: { positive: ['Grants'], negative: ['Intern'] },
    location: { alwaysAllow: [], allow: ['London', 'Remote'], block: [] },
  };

  it('adds matches, archives rule breaks with the reason, and only counts title misses', () => {
    const space = tempSpace();
    const intake = new Intake(space.db, space.jobs, rules, 'run_1');
    intake.add(
      { url: 'https://a.org/1', title: 'Grants Manager', company: 'A', location: 'London' },
      'greenhouse',
    );
    intake.add(
      { url: 'https://a.org/2', title: 'Grants Officer', company: 'B', location: 'Paris' },
      'greenhouse',
    );
    intake.add(
      { url: 'https://a.org/3', title: 'Grants Intern', company: 'C', location: 'London' },
      'greenhouse',
    );
    expect(intake.stats).toMatchObject({ found: 3, filteredTitle: 1, filteredRules: 1 });
    expect(intake.stats.added).toHaveLength(1);
    const archived = space.jobs.query({ list: 'archive' }).items[0];
    expect(archived).toMatchObject({ company: 'B', archiveReason: 'rules', movedBy: 'rules' });
    expect(archived?.archiveDetail).toMatch(/Paris/);
  });

  it('merges the same job seen on another link or source', () => {
    const space = tempSpace();
    const one = new Intake(space.db, space.jobs, rules, 'run_1');
    one.add(
      {
        url: 'https://a.org/1?utm_source=x',
        title: 'Grants Manager',
        company: 'Acme Ltd',
        location: 'London',
      },
      'greenhouse',
    );
    const two = new Intake(space.db, space.jobs, rules, 'run_2');
    two.add(
      { url: 'https://a.org/1', title: 'Grants Manager', company: 'Acme', location: 'London' },
      'adzuna',
    );
    two.add(
      {
        url: 'https://agg.example/9',
        title: 'Grants Manager',
        company: 'Acme',
        location: 'London, UK',
      },
      'adzuna',
    );
    expect(two.stats.duplicates).toBe(2);
    expect(space.jobs.counts().inbox).toBe(1);
    const job = space.jobs.query({ list: 'inbox' }).items[0];
    expect(job?.sources.map((s) => s.source)).toEqual(['greenhouse', 'adzuna', 'adzuna']);
  });

  it('skips links an earlier scan already saw', () => {
    const space = tempSpace();
    new Intake(space.db, space.jobs, rules, 'r1').add(
      { url: 'https://a.org/x', title: 'Grants Intern', company: 'A' },
      'greenhouse',
    );
    const again = new Intake(space.db, space.jobs, rules, 'r2');
    again.add({ url: 'https://a.org/x', title: 'Grants Intern', company: 'A' }, 'greenhouse');
    expect(again.stats.seenBefore).toBe(1);
  });

  it('keeps a tailored application on the job and logs it', () => {
    const { jobs } = tempSpace();
    const job = jobs.insert({
      url: 'https://x.org/9',
      company: 'Acme',
      role: 'Grants Manager',
      source: 'test',
      list: 'scored',
      movedBy: 'score',
      addedBy: 'scan',
    });
    const doc = { ok: true, error: null, pages: 2, problems: [] };
    jobs.setApplication(job.id, {
      summary: 'Leads with the £2m grants programme.',
      requirements: [
        { text: 'Grant writing', need: 'must', status: 'shown', where: 'Example Trust' },
      ],
      stretches: [],
      verdict: 'Yes, you would get an interview.',
      cv: doc,
      cover: { ...doc, pages: 1 },
      at: '2026-11-01T12:00:00.000Z',
      runId: 'run_1',
    });
    expect(jobs.get(job.id)?.application).toMatchObject({ cv: { pages: 2 }, cover: { pages: 1 } });
    expect(jobs.detail(job.id).timeline.at(-1)?.text).toBe('CV and cover letter written');
  });
});
