import { join } from 'node:path';
import type { RunKind, Settings } from '@winnow/api';
import { afterEach, describe, expect, it } from 'vitest';
import { replayAdapter } from '../adapters/replay.ts';
import { installSkills } from '../ai/run-skill.ts';
import { REPO_ROOT } from '../config.ts';
import { getSources, setSettings } from '../library.ts';
import type { Executor } from '../runs/runner.ts';
import { Runner } from '../runs/runner.ts';
import { Slots } from '../runs/slots.ts';
import { Intake } from '../scan/intake.ts';
import { closePastDeadlines } from '../scan/portals.ts';
import { confirmProfile, finishSetup, getSetup, saveSetup, updateSetup } from '../setup.ts';
import { tempSpace } from '../test-helpers.ts';
import { coverageReport, placeCountries, recordCoverage } from './coverage.ts';
import { catalogue, countries, entryFits } from './data.ts';
import { lastPage, matches, parseCataloguePage, subjectStems } from './erasmus.ts';
import { parseFeed, studyRelevant } from './feeds.ts';
import { draftEssays, findFunding, matchProgrammes } from './links.ts';
import { getMode, getStudy, setMode, setStudy } from './mode.ts';
import { autoLink, cleanOpportunity, guessKind, seedOpportunity } from './opportunity.ts';
import { updatePlan } from './plan.ts';
import { studyScore } from './score.ts';
import { studySearch } from './search.ts';
import { studyHold, studyTriage } from './triage.ts';

const REPLAY = join(REPO_ROOT, 'fixtures/replay');
const runners: Runner[] = [];
afterEach(() => {
  for (const r of runners.splice(0)) r.close();
});

const CV = `# Ada Okafor\n\n${'BSc Biochemistry, first class. Thesis on haematopoiesis. '.repeat(8)}`;
const PAGE = 'A scholarship for master’s study in the UK. '.repeat(20);

function setup(executors: Partial<Record<RunKind, Executor>> = {}) {
  const space = tempSpace();
  space.profile.set({ cv: CV, profileYaml: 'study:\n  level: Master’s\n' });
  installSkills(join(REPO_ROOT, 'skills'), space.library);
  setSettings(space.db, { cli: 'replay' } as Partial<Settings>);
  setMode(space.db, 'scholarships');
  const never: Executor = async () => ({ summary: 'nothing' });
  const all = Object.fromEntries(
    (
      [
        'scan_portals',
        'scan_ats',
        'scan_ai',
        'capture',
        'cv_import',
        'profile_prefill',
        'setup_followup',
        'profile_draft',
        'sources_suggest',
        'scan_jack',
        'jack_update',
        'tailor',
        'find_portal',
      ] as RunKind[]
    ).map((k) => [k, never]),
  ) as Record<RunKind, Executor>;
  const runner = new Runner(
    space,
    new Slots({ scan: 1, ai: 2 }),
    {
      ...all,
      triage: studyTriage,
      score: studyScore,
      scan_ai: studySearch,
      match_programmes: matchProgrammes,
      find_funding: findFunding,
      essays: draftEssays,
      ...executors,
    },
    () => replayAdapter(REPLAY),
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

const finished = (runner: Runner, id: string | undefined) =>
  until(() => {
    const r = runner.store.get(id ?? '');
    return r && !['queued', 'running'].includes(r.status) ? r : null;
  });

describe('mode and study preferences', () => {
  it('defaults to jobs, and scholarships rules block excluded countries and other levels', () => {
    const space = tempSpace();
    expect(getMode(space.db)).toBe('jobs');
    setMode(space.db, 'scholarships');
    setStudy(space.db, {
      nationality: 'Nigerian',
      places: {
        prefer: ['United Kingdom', 'Europe'],
        allow: ['Canada'],
        exclude: ['United States'],
      },
      workYears: 1,
    });
    const rules = getSources(space.db).rules;
    expect(rules.location.block).toEqual(['United States']);
    expect(rules.title.negative).toContain('PhD');
    expect(getStudy(space.db)).toMatchObject({ nationality: 'Nigerian', workYears: 1 });
    expect(() => setMode(space.db, 'other')).toThrow();

    const intake = new Intake(space.db, space.jobs, rules, 'run');
    intake.add(
      {
        url: 'https://x.org/fulbright',
        title: 'Fulbright',
        location: 'United States',
        kind: 'scholarship',
      },
      'feed',
    );
    intake.add(
      { url: 'https://x.org/phd', title: 'PhD Scholarship in Neuroscience', kind: 'scholarship' },
      'feed',
    );
    const got = intake.add(
      {
        url: 'https://x.org/ok',
        title: 'MSc Scholarship',
        location: 'Germany',
        kind: 'scholarship',
      },
      'feed',
    );
    expect(space.jobs.counts()).toMatchObject({ inbox: 1, archive: 1 });
    expect(space.jobs.require(got as string).kind).toBe('scholarship');
  });

  it('opens regions into countries', () => {
    const europe = placeCountries(['Europe']);
    expect(europe).toContain('Germany');
    expect(europe).toContain('United Kingdom');
    expect(europe).not.toContain('Canada');
    expect(placeCountries(['Nordics'])).toEqual(
      expect.arrayContaining(['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland']),
    );
  });
});

describe('data', () => {
  it('ships country cards and a catalogue with working shapes', () => {
    expect(countries().length).toBeGreaterThan(15);
    const kinds = new Set(catalogue().map((e) => e.kind));
    expect(kinds).toEqual(new Set(['scheme', 'university', 'feed', 'erasmus']));
    for (const e of catalogue()) expect(e.url).toMatch(/^https:\/\//);
    const fulbright = catalogue().find((e) => e.name.startsWith('Fulbright'));
    const study = {
      ...getStudy(tempSpace().db),
      places: { prefer: [], allow: [], exclude: ['United States'] },
    };
    expect(fulbright && entryFits(fulbright, study)).toBe(false);
  });
});

describe('feeds and the Erasmus Mundus catalogue', () => {
  it('reads RSS items and keeps the ones about funded study', () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Fully funded MSc scholarships at Example University]]></title>
        <link>https://news.example/msc</link><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
        <description>Open to international master&#8217;s students</description></item>
      <item><title>Top 10+ Scholarships for Women</title><link>https://news.example/top</link></item>
      <item><title>Undergraduate Scholarship for School Leavers</title><link>https://news.example/ug</link>
        <description>For bachelor students</description></item>
      <item><title>Research Assistant job</title><link>https://news.example/job</link></item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ url: 'https://news.example/msc' });
    expect(items[0]?.description).toContain('master’s');
    expect(items.filter((i) => studyRelevant(i, 'master’s')).map((i) => i.url)).toEqual([
      'https://news.example/msc',
    ]);
  });

  it('reads programme cards and picks them by subject stems', () => {
    const html = `
      <div class="ecl-content-block__title"><a href="https://a.eu/" class="x"><span class="ecl-link__label">Joint Master in Biomedical Engineering</span></a></div>
      <div class="ecl-content-block__title"><a href="https://b.eu/" class="x"><span class="ecl-link__label">Quantum Technologies</span></a></div>
      <a href="?page=1">2</a><a href="?page=11">12</a>`;
    const progs = parseCataloguePage(html);
    expect(progs).toHaveLength(2);
    expect(lastPage(html)).toBe(11);
    const stems = subjectStems({ name: 'EM' }, [
      { title: 'MSc Molecular Medicine', fit: 'dream' },
      { title: 'MSc Biomedical Sciences', fit: 'good' },
    ]);
    expect(stems).toEqual(expect.arrayContaining(['molecu', 'medici', 'biomed']));
    expect(progs.filter((p) => matches(p.title, stems)).map((p) => p.url)).toEqual([
      'https://a.eu/',
    ]);
    expect(subjectStems({ name: 'EM', keywords: ['neuro'] }, [])).toEqual(['neuro']);
  });
});

describe('facts and links', () => {
  it('cleans facts without failing on what a page leaves out', () => {
    const o = cleanOpportunity(
      { funding: 'nonsense', deadlines: { scholarship: '15 January', admission: '2027-02-01' } },
      'programme',
    );
    expect(o).toMatchObject({
      kind: 'programme',
      funding: 'unknown',
      deadlines: { scholarship: null, admission: '2027-02-01' },
      round: 'unknown',
    });
    expect(guessKind('MSc Molecular Medicine')).toBe('programme');
    expect(guessKind('Chevening Scholarships 2027')).toBe('scholarship');
  });

  it('links a scheme to programmes at the schools it names, and a country scheme to its country', () => {
    const space = tempSpace();
    const jobs = space.jobs;
    const add = (
      url: string,
      role: string,
      company: string,
      opp: ReturnType<typeof seedOpportunity>,
    ) =>
      jobs.insert({
        url,
        role,
        company,
        location: opp.countries.join(', '),
        source: 't',
        list: 'inbox',
        movedBy: 'scan',
        addedBy: 'scan',
        kind: opp.kind,
        opportunity: opp,
      });
    const edin = add(
      'https://x.org/p1',
      'MSc Biomedical Sciences',
      'University of Edinburgh',
      seedOpportunity('programme', {
        university: 'University of Edinburgh',
        countries: ['United Kingdom'],
      }),
    );
    const munich = add(
      'https://x.org/p2',
      'MSc Molecular Medicine',
      'TU Munich',
      seedOpportunity('programme', { university: 'TU Munich', countries: ['Germany'] }),
    );
    const mc = add(
      'https://x.org/s1',
      'Mastercard Foundation Scholars',
      'Mastercard Foundation',
      seedOpportunity('scholarship', { shape: 'many_schools', schools: ['Edinburgh'] }),
    );
    const daad = add(
      'https://x.org/s2',
      'DAAD Study Scholarship',
      'DAAD',
      seedOpportunity('scholarship', { shape: 'country', countries: ['Germany'] }),
    );
    expect(autoLink(jobs, mc.id)).toBe(1);
    expect(autoLink(jobs, munich.id)).toBe(1);
    expect(jobs.require(mc.id).links.map((l) => l.id)).toEqual([edin.id]);
    expect(jobs.require(munich.id).links).toEqual([
      expect.objectContaining({ id: daad.id, relation: 'eligible', kind: 'scholarship' }),
    ]);
    // Linking again never weakens a link, and an unlink is clean.
    jobs.link(mc.id, edin.id, 'eligible');
    expect(jobs.require(edin.id).links[0]?.relation).toBe('covers');
    jobs.unlink(mc.id, edin.id);
    expect(jobs.require(edin.id).links).toEqual([]);
  });

  it('keeps the deadline that matters and archives when it passes, saying a round can come back', () => {
    const space = tempSpace();
    const past = '2020-01-01';
    const s = space.jobs.insert({
      url: 'https://x.org/old',
      role: 'Old Scholarship',
      company: 'X',
      source: 't',
      list: 'inbox',
      movedBy: 'scan',
      addedBy: 'scan',
      kind: 'scholarship',
      opportunity: seedOpportunity('scholarship', {
        deadlines: { scholarship: past, admission: '2099-01-01' },
      }),
    });
    expect(s.due).toBe(past);
    expect(closePastDeadlines(space.jobs, null)).toBe(1);
    expect(space.jobs.require(s.id).archiveDetail).toMatch(/new round/);
  });

  it('builds a plan with a track per chosen scholarship and the page’s checklist', () => {
    const space = tempSpace();
    const prog = space.jobs.insert({
      url: 'https://x.org/p',
      role: 'MSc Neuroscience',
      company: 'Uni',
      source: 't',
      list: 'scored',
      movedBy: 'you',
      addedBy: 'you',
      kind: 'programme',
      opportunity: seedOpportunity('programme', {
        deadlines: { scholarship: null, admission: '2099-03-01' },
        documents: ['Transcript', 'CV'],
        essays: ['Research proposal'],
      }),
    });
    const sch = space.jobs.insert({
      url: 'https://x.org/s',
      role: 'Uni Global Award',
      company: 'Uni',
      source: 't',
      list: 'scored',
      movedBy: 'you',
      addedBy: 'you',
      kind: 'scholarship',
      opportunity: seedOpportunity('scholarship', {
        deadlines: { scholarship: '2099-01-10', admission: null },
      }),
    });
    const plan = updatePlan(space.jobs, prog.id, { fundingIds: [sch.id, 'nope'] });
    expect(plan.tracks.map((t) => [t.label, t.deadline])).toEqual([
      ['Admission', '2099-03-01'],
      ['Uni Global Award', '2099-01-10'],
    ]);
    expect(plan.checklist.map((c) => c.label)).toEqual([
      'Transcript',
      'CV',
      'Essay: Research proposal',
    ]);
    const next = updatePlan(space.jobs, prog.id, {
      tracks: [{ key: sch.id, status: 'submitted' }],
    });
    expect(next.tracks[1]?.status).toBe('submitted');
    expect(next.fundingIds).toEqual([sch.id]);
  });
});

describe('scholarship runs (replay)', () => {
  const newItem = (
    space: ReturnType<typeof tempSpace>,
    i: number,
    kind: 'scholarship' | 'programme',
  ) =>
    space.jobs.insert({
      url: `https://x.org/item-${i}`,
      role: kind === 'programme' ? `MSc Item ${i}` : `Scholarship ${i}`,
      company: 'Feed',
      source: 'feed',
      list: 'inbox',
      movedBy: 'scan',
      addedBy: 'scan',
      kind,
      opportunity: seedOpportunity(kind),
      jd: PAGE,
    });

  it('triage reads facts, discards the ineligible with the reason, and links pairs', async () => {
    const { space, runner } = setup();
    const items = [
      newItem(space, 0, 'scholarship'),
      newItem(space, 1, 'programme'),
      newItem(space, 2, 'scholarship'),
    ];
    const [run] = runner.enqueue({ kind: 'triage', jobIds: items.map((j) => j.id) });
    const done = await finished(runner, run?.id);
    expect(done.status).toBe('succeeded');
    const [a, b, c] = items.map((j) => space.jobs.require(j.id));
    expect(a?.opportunity).toMatchObject({ funding: 'full', schools: ['University of Replay'] });
    expect(a?.due).toBe('2099-01-15');
    expect(b?.company).toBe('University of Replay');
    expect(c).toMatchObject({ list: 'archive', archiveReason: 'triage' });
    expect(c?.triage?.reason).toMatch(/^Not eligible: /);
    // The scheme names the programme's university: they are linked.
    expect(a?.links.map((l) => l.id)).toEqual([b?.id]);
    expect(done.summary).toMatch(/1 linked/);
  });

  it('scores with six dimensions and refreshes the facts', async () => {
    const { space, runner } = setup();
    const item = newItem(space, 0, 'scholarship');
    const [run] = runner.enqueue({ kind: 'score', jobIds: [item.id] });
    expect((await finished(runner, run?.id)).status).toBe('succeeded');
    const got = space.jobs.require(item.id);
    expect(got.list).toBe('scored');
    expect(got.score?.dimensions.map((d) => d.key)).toEqual([
      'eligibility',
      'fit',
      'funding',
      'odds',
      'place',
      'effort',
    ]);
    expect(got.due).toBe('2099-02-01');
    expect(space.jobs.detail(item.id).timeline.some((t) => t.kind === 'deadline')).toBe(true);
  });

  it('finds programmes under a scholarship and funding for a programme, linked both ways', async () => {
    const { space, runner } = setup();
    const sch = newItem(space, 0, 'scholarship');
    space.jobs.setOpportunity(sch.id, seedOpportunity('scholarship', { shape: 'many_schools' }));
    const [m] = runner.enqueue({ kind: 'match_programmes', jobIds: [sch.id] });
    const done = await finished(runner, m?.id);
    expect(done).toMatchObject({ status: 'succeeded', summary: '2 programmes · 2 new' });
    const links = space.jobs.require(sch.id).links;
    expect(links.map((l) => [l.title, l.relation])).toEqual([
      ['MSc Replay Biomedicine', 'covers'],
      ['MSc Replay Neuroscience', 'covers'],
    ]);
    expect(done.result?.triageRun).toBeTruthy();

    const prog = links[0]?.id as string;
    const [f] = runner.enqueue({ kind: 'find_funding', jobIds: [prog] });
    expect((await finished(runner, f?.id)).status).toBe('succeeded');
    expect(space.jobs.require(prog).links.map((l) => l.title)).toContain(
      'Replay Global Scholarship',
    );
    expect(() => runner.enqueue({ kind: 'find_funding', jobIds: [sch.id] })).toThrow(/programmes/);
  });

  it('drafts essays into the item’s application folder', async () => {
    const { space, runner } = setup();
    const item = newItem(space, 0, 'scholarship');
    const [run] = runner.enqueue({ kind: 'essays', jobIds: [item.id] });
    expect((await finished(runner, run?.id)).summary).toBe('1 essay drafted');
    expect(space.jobs.detail(item.id).essays).toMatch(/Replay essay/);
  });

  it('AI search sweeps each place and records coverage, even for nothing found', async () => {
    const { space, runner } = setup();
    setStudy(space.db, { places: { prefer: ['Germany'], allow: [], exclude: [] } });
    const [run] = runner.enqueue({ kind: 'scan_ai', options: { autoTriage: false } });
    const done = await finished(runner, run?.id);
    expect(done.status).toBe('succeeded');
    const item = space.jobs.byUrl('https://replay.example/de/msc-molmed');
    expect(item).toMatchObject({ kind: 'programme', location: 'Germany' });
    expect(item?.opportunity?.funding).toBe('tuition_free');
    const report = coverageReport(space.db, getStudy(space.db));
    const de = report.countries.find((c) => c.facts.name === 'Germany');
    expect(de).toMatchObject({ stance: 'prefer', open: 1, note: 'Replay: 12 checked, 1 fits' });
    expect(de?.checkedAt).toBeTruthy();
    recordCoverage(space.db, 'feed', 'Example feed', { found: 10, added: 0, note: 'nothing new' });
    expect(coverageReport(space.db, getStudy(space.db)).rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'Example feed', found: 10 })]),
    );
  });
});

describe('studyHold', () => {
  const base = {
    id: 'x',
    title: '',
    org: '',
    reason: 'Fits',
    verdict: 'keep' as const,
    facts: seedOpportunity('scholarship'),
  };
  it('turns a keep with a passed deadline into unsure, unless a round is coming', () => {
    const past = {
      ...base,
      facts: { ...base.facts, deadlines: { scholarship: '2020-01-01', admission: null } },
    };
    expect(studyHold(past, '2026-11-14').verdict).toBe('unsure');
    expect(
      studyHold({ ...past, facts: { ...past.facts, round: 'upcoming' } }, '2026-11-14').verdict,
    ).toBe('keep');
  });
});

describe('setup in scholarships mode', () => {
  it('saves study wants, writes the study profile and adds ticked pages and feeds', () => {
    const space = tempSpace();
    setMode(space.db, 'scholarships');
    space.profile.set({ cv: CV });
    updateSetup(space, {
      about: { name: 'Ada', nationality: 'Nigerian' },
      want: {
        roles: [{ title: 'MSc Molecular Medicine', fit: 'dream' }],
        study: {
          fundingNeed: 'any',
          places: { prefer: ['United Kingdom'], allow: ['Canada'], exclude: ['United States'] },
        },
      },
      answers: [{ key: 'why', answer: 'Because of my thesis.' }],
    });
    const s = getSetup(space);
    expect(s.mode).toBe('scholarships');
    expect(s.answers.map((a) => a.key)).toEqual(['why']);
    confirmProfile(space, { draft: { headline: 'H', narrative: 'N'.repeat(10) } }, 'a@b.c');
    const yaml = space.profile.get().profileYaml;
    expect(yaml).toMatch(/study:/);
    expect(yaml).toMatch(/nationality: Nigerian/);
    expect(getSources(space.db).rules.location.block).toEqual(['United States']);
    saveSetup(space, {
      suggestions: {
        companies: [{ name: 'Page A', provider: 'page', careers_url: 'https://a.org' }],
        careerSites: [],
        boards: [{ name: 'Feed A', provider: 'rss', api: 'https://a.org/feed' }],
        queries: [{ name: 'Q', query: 'q', enabled: true }],
        titles: { positive: [], negative: [] },
        dropped: [],
      },
    });
    finishSetup(space, { companies: ['Page A'], boards: ['Feed A'], queries: ['Q'] });
    const sources = getSources(space.db);
    expect(sources.companies.map((c) => c.name)).toEqual(['Page A']);
    expect(sources.boards.map((c) => c.name)).toEqual(['Feed A']);
    expect(sources.queries).toHaveLength(1);
    expect(getSetup(space).status).toBe('done');
  });
});
