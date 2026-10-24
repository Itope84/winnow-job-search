import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Run, Settings } from '@winnow/api';
import { afterEach, describe, expect, it } from 'vitest';
import { replayAdapter } from '../adapters/replay.ts';
import { installSkills } from '../ai/run-skill.ts';
import { REPO_ROOT } from '../config.ts';
import { getSources, setSettings, setSources } from '../library.ts';
import { type Executor, Runner } from '../runs/runner.ts';
import { Slots } from '../runs/slots.ts';
import { tempSpace } from '../test-helpers.ts';
import { JACK, JackLink } from './jack.ts';
import { jackDate, jackScan, radarOffer } from './jack-scan.ts';
import { applyDraft, editDraft, getDraft, jackDraft, overview } from './jack-sync.ts';

const CV = `# Ada Lovelace\n\n${'Grants manager at Example Trust, running £2m a year. '.repeat(8)}`;

/** A fake Jack: OAuth that always succeeds, and tools answered from `tools`. */
function fakeJack(tools: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/register')) return json({ client_id: 'jjkc_test' }, 201);
    if (url.endsWith('/token'))
      return json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    if (url === JACK.mcp) {
      const req = JSON.parse(String(init?.body)) as {
        id: number;
        params: { name: string; arguments: Record<string, unknown> };
      };
      calls.push({ tool: req.params.name, args: req.params.arguments });
      const answer = tools[req.params.name];
      return json({
        jsonrpc: '2.0',
        id: req.id,
        result: answer
          ? {
              content: [{ type: 'text', text: '' }],
              structuredContent: answer(req.params.arguments),
            }
          : { content: [{ type: 'text', text: `no ${req.params.name}` }], isError: true },
      });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { http, calls };
}

const runners: Runner[] = [];
afterEach(() => {
  for (const r of runners.splice(0)) r.close();
});

async function connected(tools: Parameters<typeof fakeJack>[0]) {
  const space = tempSpace();
  space.profile.set({
    cv: CV,
    profileYaml: 'target_roles:\n  primary: [Grants Manager]\n',
    narrative: '## Who I am\n\nGrants manager.',
  });
  installSkills(join(REPO_ROOT, 'skills'), space.library);
  setSettings(space.db, { cli: 'replay' } as Partial<Settings>);
  const jack = fakeJack(tools);
  const link = new JackLink(mkdtempSync(join(tmpdir(), 'winnow-jack-')), jack.http);
  const start = await link.start(space.db);
  const state = new URL(start.url).searchParams.get('state');
  await link.finish(space.db, `${JACK.redirect}?code=c&state=${state}`);
  const never: Executor = async () => ({ summary: 'nothing' });
  const runner = new Runner(
    space,
    new Slots({ scan: 1, ai: 1 }),
    {
      scan_portals: never,
      scan_ats: never,
      scan_ai: never,
      triage: never,
      score: never,
      capture: never,
      cv_import: never,
      profile_prefill: never,
      setup_followup: never,
      profile_draft: never,
      sources_suggest: never,
      scan_jack: jackScan(link),
      jack_update: jackDraft(link),
    },
    () => replayAdapter(join(REPO_ROOT, 'fixtures/replay')),
    join(REPO_ROOT, 'skills'),
  );
  runners.push(runner);
  runner.start();
  return { space, link, runner, calls: jack.calls };
}

async function finished(runner: Runner, id: string, ms = 5000): Promise<Run> {
  const start = Date.now();
  for (;;) {
    const run = runner.store.require(id);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    if (Date.now() - start > ms) throw new Error(`run still ${run.status}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const ROLE = {
  title: 'Product Engineer (£70k-£185k + Equity) at Omnea',
  company: 'Omnea',
  location: 'London, UK (Hybrid)',
  pitch: `# Product Engineer at Omnea\n\n${'We are hiring product engineers. '.repeat(20)}`,
  posted_at: '2026-09-29T04:13:17.029918+00:00',
  jack_url: 'https://app.jackandjill.ai/jack/dashboard/jobs/f832673f',
};

describe('Jack scan', () => {
  it('reads Jack’s dates and tidies Jill role titles', () => {
    expect(
      new Date(jackDate('Tuesday the 6th of October 2026 at 12:00 AM') ?? 0).toISOString(),
    ).toBe('2026-10-06T00:00:00.000Z');
    expect(jackDate('soon')).toBeUndefined();
    expect(radarOffer(ROLE)).toMatchObject({
      title: 'Product Engineer',
      company: 'Omnea',
      salary: { text: '£70k-£185k + Equity' },
      url: ROLE.jack_url,
    });
  });

  it('adds Jill roles past title words, and searches only on a saved brief', async () => {
    let briefEmpty = true;
    const { space, runner, calls } = await connected({
      get_radar_roles: () => ({ status: 'ok', roles: [ROLE] }),
      get_account_status: () => ({ search_brief: { is_empty: briefEmpty } }),
      search_jobs: () => ({ status: 'running', search_id: 's1' }),
      get_search_status: () => ({
        status: 'complete',
        jobs: [
          {
            title: 'Grants Manager',
            company: 'River Aid',
            location: 'London (Hybrid)',
            salary: 'est. £45,000 - £55,000',
            posted_at: 'Friday the 23rd of October 2026 at 12:00 AM',
            posting_url: 'https://jobs.ashbyhq.com/riveraid/1',
            jack_url: 'https://app.jackandjill.ai/jack/dashboard/jobs/1',
            // Long enough to count as the description, so the scan doesn't fetch the posting.
            why_it_fits: 'Runs a grants team. '.repeat(20),
          },
          { title: 'Chef', company: 'Cafe', posting_url: 'https://example.org/chef' },
        ],
      }),
    });
    const sources = getSources(space.db);
    setSources(space.db, {
      ...sources,
      rules: {
        ...sources.rules,
        title: { positive: ['Grants'], negative: [] },
        // Nowhere near the jobs: Jill roles skip the rules; Jack's results are archived with the reason.
        location: { alwaysAllow: [], allow: ['Manchester, UK'], block: [] },
      },
    });

    // Empty brief: Jill roles only, and the run says why there was no search.
    const [first] = runner.enqueue({ kind: 'scan_jack', options: { autoTriage: false } });
    const run1 = await finished(runner, first?.id ?? '');
    expect(run1.status).toBe('succeeded');
    expect(run1.summary).toMatch(/brief is empty/);
    expect(calls.some((c) => c.tool === 'search_jobs')).toBe(false);
    const jill = space.jobs.byUrl(ROLE.jack_url);
    expect(jill).toMatchObject({ role: 'Product Engineer', company: 'Omnea', list: 'inbox' });
    expect(jill?.sources.map((s) => s.source)).toEqual(['jill']);

    // With a brief: Jack searches, and title rules apply to what it finds.
    briefEmpty = false;
    const [second] = runner.enqueue({ kind: 'scan_jack', options: { autoTriage: false } });
    const run2 = await finished(runner, second?.id ?? '');
    expect(run2.status).toBe('succeeded');
    expect(calls.find((c) => c.tool === 'search_jobs')?.args).toEqual({
      query: 'Search on the brief',
    });
    expect(space.jobs.byUrl('https://jobs.ashbyhq.com/riveraid/1')).toMatchObject({
      company: 'River Aid',
      salary: 'est. £45,000 - £55,000',
      postedAt: '2026-10-23',
    });
    expect(space.jobs.byUrl('https://example.org/chef')).toBeNull();
    expect(run2.result).toMatchObject({ radar: 1, searched: 2, filteredTitle: 1 });
    const riverAid = space.jobs.byUrl('https://jobs.ashbyhq.com/riveraid/1');
    expect(riverAid).toMatchObject({ list: 'archive', archiveReason: 'rules' });
  });

  it('fails plainly when Jack isn’t connected', async () => {
    const { space, link, runner } = await connected({});
    await link.disconnect(space.db);
    const [run] = runner.enqueue({ kind: 'scan_jack' });
    expect((await finished(runner, run?.id ?? '')).error).toMatch(/Connect your Jack account/);
  });
});

describe('Update Jack', () => {
  const profile = {
    profile: {
      headline: 'Grants manager',
      summary: '',
      skills: [],
      experiences: [
        {
          key: 'exp1',
          title: 'Grants Manager',
          company: { name: 'Example Trust' },
          description: '',
        },
      ],
      education: [],
    },
    improvements: ['Narrative fields still empty: summary'],
  };

  it('reads edited pay back into a band', async () => {
    const { space, runner } = await connected({
      get_profile: () => profile,
      get_search_brief: () => ({ brief: {}, completeness: {} }),
    });
    const [run] = runner.enqueue({ kind: 'jack_update' });
    await finished(runner, run?.id ?? '');
    const pay = getDraft(space.db)?.brief.findIndex((e) => e.field === 'pay') ?? -1;
    const out = editDraft(space.db, {
      part: 'brief',
      index: pay,
      text: 'GBP floor 90,000 target 120,000',
    });
    expect(out.brief[pay]?.value).toEqual({ currency: 'GBP', floor: 90000, target: 120000 });
  });

  it('drafts only edits Jack takes, then sends the ticked ones and keeps the rest', async () => {
    const sent: Record<string, unknown>[] = [];
    const { space, link, runner } = await connected({
      get_profile: () => profile,
      get_search_brief: () => ({ brief: { role_titles: [], pay: {} }, completeness: {} }),
      get_account_status: () => ({
        visibility: 'visible',
        profile: { missing_fields: ['summary'] },
        search_brief: { is_empty: true, missing_fields: ['role_titles'] },
        radar: { available: true },
      }),
      update_search_brief: (args) => {
        sent.push({ tool: 'brief', ...args });
        return { status: 'ok' };
      },
      update_profile: (args) => {
        sent.push({ tool: 'profile', ...args });
        const edit = (args.edits as { field: string }[])[0];
        return edit?.field === 'summary'
          ? { status: 'sanitization_failed', feedback: 'Rewrite without age.' }
          : { status: 'ok' };
      },
    });
    const [run] = runner.enqueue({ kind: 'jack_update' });
    expect((await finished(runner, run?.id ?? '')).status).toBe('succeeded');

    const draft = getDraft(space.db);
    expect(draft?.brief.map((e) => e.field)).toEqual(['role_titles', 'seniority_levels', 'pay']);
    expect(draft?.brief[1]?.value).toEqual(['senior']);
    expect(draft?.brief[0]?.after).toBe('Grants Manager, Head of Partnerships');
    expect(draft?.brief[2]).toMatchObject({
      op: 'add',
      value: { currency: 'GBP', floor: 45000, target: 55000 },
    });
    expect(draft?.profile.map((e) => [e.field, e.itemKey])).toEqual([
      ['summary', null],
      ['experiences', 'exp1'],
    ]);
    expect(draft?.profile[1]).toMatchObject({
      entry: 'Grants Manager at Example Trust',
      before: null,
      after: '- Ran £2m a year of grants',
    });

    const out = await applyDraft(link, space.db, { brief: [0, 2], profile: [0, 1] });
    expect(out.sent).toBe(3);
    expect(out.failed).toEqual([{ part: 'profile', message: 'Rewrite without age.' }]);
    expect(sent[0]).toEqual({
      tool: 'brief',
      edits: [
        { field: 'role_titles', op: 'set', value: ['Grants Manager', 'Head of Partnerships'] },
        { field: 'pay', op: 'add', value: { currency: 'GBP', floor: 45000, target: 55000 } },
      ],
    });
    expect(sent.at(-1)).toEqual({
      tool: 'profile',
      edits: [
        {
          field: 'experiences',
          op: 'update',
          value: { description: '- Ran £2m a year of grants' },
          item_key: 'exp1',
        },
      ],
    });
    // Unticked and refused edits stay for another go.
    expect(getDraft(space.db)?.brief.map((e) => e.field)).toEqual(['seniority_levels']);
    expect(getDraft(space.db)?.profile.map((e) => e.field)).toEqual(['summary']);
    expect(out.overview.account).toMatchObject({ visible: true, briefEmpty: true, radar: true });
    expect((await overview(link, space.db)).draft?.brief).toHaveLength(1);

    // The refused edit keeps Jack's reason until the person rewrites it.
    expect(getDraft(space.db)?.profile[0]?.problem).toBe('Rewrite without age.');
    const fixed = editDraft(space.db, {
      part: 'profile',
      index: 0,
      text: 'Runs grant programmes.',
    });
    expect(fixed.profile[0]).toMatchObject({
      value: 'Runs grant programmes.',
      after: 'Runs grant programmes.',
    });
    expect(fixed.profile[0]?.problem).toBeUndefined();
    // Fixed-value fields take the words shown, and refuse others.
    expect(
      editDraft(space.db, { part: 'brief', index: 0, text: 'Senior, mid' }).brief[0],
    ).toMatchObject({
      value: ['senior', 'mid'],
      after: 'senior, mid',
    });
    expect(() => editDraft(space.db, { part: 'brief', index: 0, text: 'staff' })).toThrow(
      /only takes/,
    );
    expect(() => editDraft(space.db, { part: 'brief', index: 5, text: 'x' })).toThrow(/no longer/);
  });
});
