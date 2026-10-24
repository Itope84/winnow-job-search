import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSources } from '../library.ts';
import { tempSpace } from '../test-helpers.ts';
import { importCareerOps } from './career-ops.ts';

function fakeCareerOps() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-'));
  for (const d of ['data/jd-cache', 'reports', 'config', 'modes', '.career-ops-web'])
    mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# Ada\n\nGrants and fundraising, 5 years.');
  writeFileSync(
    join(dir, 'config/profile.yml'),
    'opencode_models:\n  default: "opencode-go/flash"\n  evaluate: "opencode-go/strong"\n',
  );
  writeFileSync(
    join(dir, 'portals.yml'),
    'title_filter:\n  positive: ["Grants"]\ntracked_companies:\n  - name: Acme\n    careers_url: https://jobs.lever.co/acme\n',
  );
  writeFileSync(
    join(dir, 'data/pipeline.md'),
    `## Pending

- [ ] https://x.org/new | acme | Grants Manager | London | posted: 2026-10-20
- [ ] https://x.org/dropme | acme | Grants Officer | London

## Processed
- [x] #001 | https://x.org/scored | Trust | Grants Lead | 4.2/5 | PDF ❌
- [x] #-- | https://x.org/skip | skipped (pre-screen mismatch: needs Spanish)

## Shortlisted
- https://x.org/saved | Charity | Programme Manager
`,
  );
  writeFileSync(
    join(dir, 'data/applications.md'),
    `| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-21 | Trust | — | Grants Lead | 4.2/5 | Evaluated | ❌ | [001](../reports/001-trust.md) | Good fit |
| 2 | 2026-10-22 | Fund | — | Grants Officer | 3.0/5 | Applied | ❌ | [002](../reports/002-fund.md) | |
`,
  );
  writeFileSync(
    join(dir, 'reports/001-trust.md'),
    '# Evaluation: Trust — Grants Lead\n\n**URL:** https://x.org/scored\n**Score:** 4.2/5\n',
  );
  writeFileSync(
    join(dir, 'reports/002-fund.md'),
    '# Evaluation: Fund — Grants Officer\n\n**URL:** https://x.org/applied\n**Score:** 3.0/5\n',
  );
  writeFileSync(
    join(dir, 'data/jd-cache/a.md'),
    `---\nurl: https://x.org/new\n---\n${'A long description. '.repeat(10)}`,
  );
  writeFileSync(
    join(dir, 'data/discard.log'),
    '2026-10-23T10:00:00Z\thttps://x.org/old\tSales role.\n',
  );
  writeFileSync(
    join(dir, '.career-ops-web/job-registry.json'),
    JSON.stringify([
      {
        kind: 'triage',
        endedAt: Date.parse('2026-10-23T12:00:00Z'),
        data: [
          { id: 'https://x.org/dropme', decision: 'discard', reason: 'Needs French' },
          { id: 'https://x.org/new', decision: 'keep', reason: '' },
        ],
      },
    ]),
  );
  return dir;
}

describe('importCareerOps', () => {
  it('brings every list over with reasons, and a second run adds nothing', () => {
    const space = tempSpace();
    const from = fakeCareerOps();
    const first = importCareerOps(from, space);
    expect(space.jobs.counts()).toEqual({
      inbox: 1,
      shortlist: 1,
      scored: 1,
      applied: 1,
      archive: 3,
      kept: 1,
    });
    expect(first.triaged).toBe(2);
    expect(first.descriptions).toBe(1);

    const scored = space.jobs.byUrl('https://x.org/scored');
    expect(scored?.score).toMatchObject({ score: 4.2, verdict: 'apply' });
    expect(space.jobs.byUrl('https://x.org/applied')).toMatchObject({
      list: 'applied',
      stage: 'applied',
    });
    expect(space.jobs.byUrl('https://x.org/dropme')).toMatchObject({
      list: 'archive',
      archiveReason: 'triage',
      archiveDetail: 'Needs French',
    });
    expect(space.jobs.byUrl('https://x.org/skip')?.archiveDetail).toBe('Pre-screen: needs Spanish');
    expect(space.jobs.byUrl('https://x.org/new')).toMatchObject({
      list: 'inbox',
      hasJd: true,
      triage: { verdict: 'keep' },
    });
    expect(getSources(space.db).companies[0]?.name).toBe('Acme');

    const events = () =>
      (space.db.prepare('SELECT COUNT(*) AS n FROM job_events').get() as { n: number }).n;
    const before = events();
    const second = importCareerOps(from, space);
    expect(second).toMatchObject({
      inbox: 0,
      shortlist: 0,
      scored: 0,
      applied: 0,
      archived: 0,
      triaged: 0,
    });
    expect(events()).toBe(before);
  });

  it('brings only the profile and sources with jobs: false', () => {
    const space = tempSpace();
    const sum = importCareerOps(fakeCareerOps(), space, { jobs: false });
    expect(sum.profile).toContain('CV');
    expect(getSources(space.db).companies[0]?.name).toBe('Acme');
    expect(space.jobs.counts()).toMatchObject({ inbox: 0, shortlist: 0, scored: 0, archive: 0 });
  });
});
