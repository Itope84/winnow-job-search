import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunKind, Settings } from '@winnow/api';
import { afterEach, describe, expect, it } from 'vitest';
import { replayAdapter } from '../adapters/replay.ts';
import { cvImport, saveCvText, uploadsDir } from '../ai/cv-import.ts';
import { installSkills } from '../ai/run-skill.ts';
import { score } from '../ai/score.ts';
import { aiSearch } from '../ai/search.ts';
import { profileDraft, profilePrefill, setupFollowup, sourcesSuggest } from '../ai/setup-runs.ts';
import { triage } from '../ai/triage.ts';
import { REPO_ROOT } from '../config.ts';
import { EMPTY_SOURCES, getSources, setSettings, setSources } from '../library.ts';
import {
  confirmProfile,
  finishSetup,
  getSetup,
  saveSetup,
  startSetup,
  updateSetup,
} from '../setup.ts';
import { tempSpace } from '../test-helpers.ts';
import { type Executor, Runner } from './runner.ts';
import { Slots } from './slots.ts';

const REPLAY = join(REPO_ROOT, 'fixtures/replay');
const runners: Runner[] = [];
afterEach(() => {
  for (const r of runners.splice(0)) r.close();
});

const CV = `# Ada Lovelace\n\n${'Grants manager at Example Trust, running £2m a year. '.repeat(8)}`;

function setup(
  executors: Partial<Record<RunKind, Executor>> = {},
  slots = new Slots({ scan: 1, ai: 2 }),
  withProfile = true,
  replay = REPLAY,
) {
  const space = tempSpace();
  // Triage and scoring refuse without a CV and profile.
  if (withProfile)
    space.profile.set({ cv: CV, profileYaml: 'target_roles:\n  primary: [Grants Manager]\n' });
  installSkills(join(REPO_ROOT, 'skills'), space.library);
  setSettings(space.db, { cli: 'replay' } as Partial<Settings>);
  const never: Executor = async () => ({ summary: 'nothing' });
  const runner = new Runner(
    space,
    slots,
    {
      scan_portals: never,
      scan_ats: never,
      scan_ai: aiSearch,
      triage,
      score,
      capture: never,
      cv_import: cvImport,
      profile_prefill: profilePrefill,
      setup_followup: setupFollowup,
      profile_draft: profileDraft,
      sources_suggest: sourcesSuggest,
      scan_jack: never,
      jack_update: never,
      ...executors,
    },
    () => replayAdapter(replay),
    join(REPO_ROOT, 'skills'),
  );
  runners.push(runner);
  runner.start();
  return { space, runner };
}

async function until<T>(fn: () => T | null | undefined | false, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Runner', () => {
  it('turns an uploaded CV into the Markdown CV and keeps the old one', async () => {
    const { space, runner } = setup();
    space.profile.set({ cv: '# Old CV' });
    mkdirSync(uploadsDir(space.library), { recursive: true });
    writeFileSync(join(uploadsDir(space.library), '1-my-cv.pdf'), '%PDF-1.7');
    writeFileSync(join(uploadsDir(space.library), '1-my-cv.txt'), 'Ada Lovelace '.repeat(40));
    const [run] = runner.enqueue({ kind: 'cv_import', upload: '1-my-cv.pdf' });
    const done = await until(() => {
      const r = runner.store.get(run?.id ?? '');
      return r && r.status !== 'queued' && r.status !== 'running' ? r : null;
    });
    expect(done).toMatchObject({ status: 'succeeded', summary: 'CV updated from my-cv.pdf' });
    expect(space.profile.get().cv).toMatch(/^# Ada Lovelace/);
    const kept = readdirSync(uploadsDir(space.library)).filter((f) => f.startsWith('cv-before-'));
    expect(kept).toHaveLength(1);
    expect(() => runner.enqueue({ kind: 'cv_import', upload: '../../secret.pdf' })).toThrow();
  });

  it('triages a big inbox in batches, two at a time, and gives every slot back', async () => {
    const slots = new Slots({ scan: 1, ai: 2 });
    const { space, runner } = setup({}, slots);
    for (let i = 0; i < 45; i++) {
      const { id } = space.jobs.insert({
        url: `https://x.org/big-${i}`,
        company: `C${i}`,
        role: 'Grants Manager',
        source: 't',
        list: 'inbox',
        movedBy: 'scan',
        addedBy: 'scan',
      });
      space.jobs.writeJd(id, 'Full description '.repeat(30));
    }
    const [run] = runner.enqueue({ kind: 'triage', scope: 'untriaged' });
    const done = await until(() => {
      const r = runner.store.get(run?.id ?? '');
      return r && r.status !== 'queued' && r.status !== 'running' ? r : null;
    });
    expect(done.status).toBe('succeeded');
    expect(done.progress).toMatchObject({ done: 45, total: 45 });
    expect(space.jobs.ids('triage_verdict IS NULL')).toEqual([]);
    expect(slots.stats().ai).toMatchObject({ used: 0, waiting: 0 });
  });

  it('triages jobs, saves every verdict and archives discards with the reason', async () => {
    const { space, runner } = setup();
    const ids = ['a', 'b', 'c'].map(
      (x) =>
        space.jobs.insert({
          url: `https://x.org/${x}`,
          company: x,
          role: 'Grants Manager',
          source: 't',
          list: 'inbox',
          movedBy: 'scan',
          addedBy: 'scan',
          jd: 'A description long enough to count as captured.',
        }).id,
    );
    for (const id of ids) space.jobs.writeJd(id, 'Full description '.repeat(30));
    const [run] = runner.enqueue({ kind: 'triage', scope: 'untriaged' });
    const done = await until(() => {
      const r = runner.store.get(run?.id ?? '');
      return r && r.status !== 'queued' && r.status !== 'running' ? r : null;
    });
    expect(done.status).toBe('succeeded');
    expect(done.summary).toBe('2 kept · 1 archived');
    const third = space.jobs.require(ids[2] as string);
    expect(third).toMatchObject({ list: 'archive', archiveReason: 'triage', movedBy: 'triage' });
    expect(third.archiveDetail).toMatch(/outside your target roles/);
    expect(space.jobs.require(ids[0] as string).triage?.verdict).toBe('keep');
  });

  it('marks a kept job with no description as unsure', async () => {
    const { space, runner } = setup();
    const id = space.jobs.insert({
      url: 'https://x.org/nojd',
      company: 'A',
      role: 'Grants Manager',
      source: 't',
      list: 'inbox',
      movedBy: 'scan',
      addedBy: 'scan',
    }).id;
    const [run] = runner.enqueue({ kind: 'triage', jobIds: [id] });
    await until(() => runner.store.get(run?.id ?? '')?.status === 'succeeded');
    expect(space.jobs.require(id).triage?.verdict).toBe('unsure');
  });

  it('scores a job, saves the report and moves it to Scored', async () => {
    const { space, runner } = setup();
    const id = space.jobs.insert({
      url: 'https://x.org/s',
      company: 'A',
      role: 'Grants Manager',
      source: 't',
      list: 'shortlist',
      movedBy: 'you',
      addedBy: 'scan',
      jd: 'Description '.repeat(40),
    }).id;
    const [run] = runner.enqueue({ kind: 'score', jobIds: [id] });
    const done = await until(() => {
      const r = runner.store.get(run?.id ?? '');
      return r && r.status !== 'queued' && r.status !== 'running' ? r : null;
    });
    expect(done.status).toBe('succeeded');
    const job = space.jobs.detail(id);
    expect(job.list).toBe('scored');
    expect(job.score).toMatchObject({ score: 4.2, verdict: 'apply' });
    expect(job.score?.dimensions).toHaveLength(5);
    expect(job.report).toMatch(/replayed report/);
    expect(runner.store.logLines(done.id).some((l) => l.kind === 'text')).toBe(true);
  });

  it('feeds AI search results through intake and the rules', async () => {
    const { space, runner } = setup();
    setSources(space.db, {
      ...EMPTY_SOURCES,
      queries: [{ name: 'q', query: 'grants london', enabled: true }],
      rules: { ...EMPTY_SOURCES.rules, title: { positive: ['Grants'], negative: [] } },
    });
    const [run] = runner.enqueue({ kind: 'scan_ai', options: { autoTriage: false } });
    const done = await until(() => {
      const r = runner.store.get(run?.id ?? '');
      return r && r.status !== 'queued' && r.status !== 'running' ? r : null;
    });
    expect(done.status).toBe('succeeded');
    expect(space.jobs.counts().inbox).toBe(1);
    expect(done.result).toMatchObject({ found: 2, filteredTitle: 1 });
  });

  it('marks running work interrupted after a restart, and resumes it', async () => {
    let release: () => void = () => {};
    const slow: Executor = (ctx) =>
      new Promise((resolve, reject) => {
        release = () => resolve({ summary: 'finished' });
        ctx.signal.addEventListener('abort', () => reject(new Error('Cancelled')));
      });
    const { space, runner } = setup({ scan_portals: slow });
    const [run] = runner.enqueue({ kind: 'scan_portals' });
    await until(() => runner.store.get(run?.id ?? '')?.status === 'running');
    // A new runner on the same space stands in for a server restart.
    const after = new Runner(
      space,
      new Slots({ scan: 1, ai: 1 }),
      {} as never,
      () => replayAdapter(REPLAY),
      '',
    );
    runners.push(after);
    after.store.interruptStale();
    expect(after.store.get(run?.id ?? '')?.status).toBe('interrupted');
    release();
  });

  it('cancels queued work and refuses a second scan of the same kind', async () => {
    const hang: Executor = (ctx) =>
      new Promise((_, reject) =>
        ctx.signal.addEventListener('abort', () => reject(new Error('Cancelled'))),
      );
    const { runner } = setup({ scan_portals: hang });
    const [run] = runner.enqueue({ kind: 'scan_portals' });
    expect(() => runner.enqueue({ kind: 'scan_portals' })).toThrow(/already/);
    await until(() => runner.store.get(run?.id ?? '')?.status === 'running');
    runner.cancel(run?.id ?? '');
    await until(() => runner.store.get(run?.id ?? '')?.status === 'cancelled');
  });
});

describe('Setup', () => {
  const finished = (runner: Runner, id: string | undefined) =>
    until(() => {
      const r = runner.store.get(id ?? '');
      return r && r.status !== 'queued' && r.status !== 'running' ? r : null;
    });

  it('takes a null follow-up as "no follow-up needed", not a missing result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'winnow-replay-'));
    writeFileSync(
      join(dir, 'setup-followup.json'),
      JSON.stringify({ steps: [{ write: { path: 'result.json', content: '{"followUp":null}' } }] }),
    );
    const { space, runner } = setup({}, undefined, true, dir);
    startSetup(space, true);
    updateSetup(space, { answers: [{ key: 'best', answer: 'Grew income from £400k to £1.1m.' }] });
    const [run] = runner.enqueue({
      kind: 'setup_followup',
      question: 'best',
      answer: 'Grew income from £400k to £1.1m.',
    });
    saveSetup(space, {
      answers: getSetup(space).answers.map((a) => ({ ...a, followUpRun: run?.id ?? null })),
    });
    expect(await finished(runner, run?.id)).toMatchObject({
      status: 'succeeded',
      summary: 'No follow-up needed',
    });
    expect(getSetup(space).answers[0]?.followUp).toBeNull();
  });

  it('refuses triage and scoring until there is a CV and profile', () => {
    const { runner } = setup({}, undefined, false);
    expect(() => runner.enqueue({ kind: 'triage', scope: 'untriaged' })).toThrow(
      /Finish setting up/,
    );
  });

  it('reads a pasted CV, pre-fills, follows up, drafts, suggests sources and finishes', async () => {
    const { space, runner } = setup({}, undefined, false);
    expect(getSetup(space).status).toBe('needed');
    startSetup(space, false);

    // A pasted CV goes through Read CV, and Pre-fill follows by itself.
    const upload = saveCvText(space.library, CV);
    const [read] = runner.enqueue({ kind: 'cv_import', upload });
    expect((await finished(runner, read?.id)).status).toBe('succeeded');
    const prefillId = await until(() => getSetup(space).runs.prefill);
    expect((await finished(runner, prefillId)).status).toBe('succeeded');
    expect(getSetup(space).prefill).toMatchObject({
      about: { name: 'Ada Lovelace', city: 'London' },
      roles: [
        { title: 'Grants Manager', fit: 'dream' },
        { title: 'Programme Manager', fit: 'good' },
      ],
      currency: 'GBP',
    });

    updateSetup(space, {
      step: 'know',
      about: {
        name: 'Ada Lovelace',
        city: 'London',
        country: 'United Kingdom',
        workRight: 'UK citizen',
      },
      want: {
        roles: [{ title: 'Grants Manager', fit: 'dream' }],
        level: 'Manager',
        workTypes: ['hybrid', 'nonsense'],
        places: ['London'],
        currency: 'GBP',
        salaryTarget: '£45K-55K',
        salaryMin: '£40K',
      },
      answers: [{ key: 'best', answer: 'I grew the programme a lot.' }],
    });
    expect(getSetup(space).want.workTypes).toEqual(['hybrid']);

    // A follow-up lands on the answer it was asked about, and is dropped once the answer changes.
    const [follow] = runner.enqueue({
      kind: 'setup_followup',
      question: 'best',
      answer: 'I grew the programme a lot.',
    });
    updateSetup(space, {
      answers: [{ key: 'best', answer: 'I grew the programme a lot.' }],
    });
    saveSetup(space, {
      answers: getSetup(space).answers.map((a) => ({ ...a, followUpRun: follow?.id ?? null })),
    });
    await finished(runner, follow?.id);
    expect(getSetup(space).answers[0]?.followUp).toMatch(/how big/);
    updateSetup(space, {
      answers: [{ key: 'best', answer: 'Grew it from £1m to £2m in two years.' }],
    });
    expect(getSetup(space).answers[0]).toMatchObject({ followUp: null, followUpRun: null });

    const [draft] = runner.enqueue({ kind: 'profile_draft' });
    expect((await finished(runner, draft?.id)).status).toBe('succeeded');
    const d = getSetup(space).draft;
    expect(d?.headline).toMatch(/Grants manager/);
    expect(d?.roleNotes).toEqual({ 'Grants Manager': 'Her current job, at the same scale.' });

    const [sources] = runner.enqueue({ kind: 'sources_suggest' });
    expect((await finished(runner, sources?.id)).status).toBe('succeeded');
    const sug = getSetup(space).suggestions;
    expect(sug?.companies.map((c) => c.name)).toEqual(['Acumen']);
    expect(sug?.careerSites.map((c) => c.name)).toEqual(['Nowhere Trust']);
    expect(sug?.boards.map((b) => b.provider)).toEqual(['adzuna']);

    expect(() => finishSetup(space, {})).toThrow(/Confirm your profile/);
    expect(confirmProfile(space, { draft: d }, 'ada@example.org')).toMatchObject({
      status: 'in_progress',
      step: 'sources',
    });
    const done = finishSetup(space, {
      companies: ['Acumen', 'Nowhere Trust'],
      boards: [],
      queries: ['Lever grants'],
    });
    expect(done.status).toBe('done');
    const yaml = space.profile.parsed() as Record<string, any>;
    expect(yaml.candidate).toMatchObject({ full_name: 'Ada Lovelace', email: 'ada@example.org' });
    expect(yaml.target_roles.archetypes[0]).toMatchObject({
      name: 'Grants Manager',
      fit: 'primary',
    });
    expect(yaml.compensation).toMatchObject({ minimum: '£40K', currency: 'GBP' });
    expect(space.profile.get().narrative).toMatch(/^## Who I am/);
    const src = getSources(space.db);
    expect(src.companies.map((c) => c.name)).toEqual(['Acumen', 'Nowhere Trust']);
    expect(src.boards).toEqual([]);
    expect(src.queries.map((q) => q.name)).toEqual(['Lever grants']);
    expect(src.rules.title.positive).toEqual(['Grants Manager', 'Grants', 'Programme']);
    expect(src.rules.salary).toMatchObject({ min: 40000, currency: 'GBP' });
    expect(space.profile.ready()).toEqual({ cv: true, profile: true });

    // Set up again starts from today's profile, and keeps the old files when it finishes.
    const again = startSetup(space, true);
    expect(again).toMatchObject({
      status: 'in_progress',
      redo: true,
      about: { name: 'Ada Lovelace' },
    });
    expect(again.want.roles).toEqual([{ title: 'Grants Manager', fit: 'dream' }]);
    confirmProfile(space, { draft: d }, 'ada@example.org');
    finishSetup(space, { companies: [], boards: [], queries: [] });
    const backups = readdirSync(uploadsDir(space.library)).filter((f) => f.includes('-before-'));
    expect(backups.some((f) => f.startsWith('profile-before-'))).toBe(true);
    expect(getSources(space.db).companies).toHaveLength(2);
  });
});
