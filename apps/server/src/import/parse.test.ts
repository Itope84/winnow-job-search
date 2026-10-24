import { describe, expect, it } from 'vitest';
import {
  mapStatus,
  parseDiscardLog,
  parseJdCache,
  parsePipeline,
  parsePortals,
  parseReport,
  parseTracker,
} from './parse.ts';

describe('parsePipeline', () => {
  const text = `# Pipeline

## Pending

- [ ] https://job-boards.greenhouse.io/affirm/jobs/1 | affirm | Senior Program Manager I | Remote US | posted: 2026-10-20
- [ ] https://www.linkedin.com/jobs/view/x-2 | The Trust | Fundraising Manager | London

## Processed
- [x] #096 | https://www.linkedin.com/jobs/view/a-3 | Sense | Philanthropy Manager | 4.1/5 | PDF ❌
- [x] #-- | https://kcura.wd1.myworkdayjobs.com/x/job/4 | skipped (pre-screen mismatch: 7+ years required)

## Shortlisted
- https://jobs.ashbyhq.com/pleo/5 | pleo | Marketing Operations Manager
`;
  const p = parsePipeline(text);
  it('reads pending lines with their posted date', () => {
    expect(p.pending).toHaveLength(2);
    expect(p.pending[0]).toMatchObject({
      company: 'affirm',
      role: 'Senior Program Manager I',
      location: 'Remote US',
      postedAt: '2026-10-20',
    });
    expect(p.pending[1]?.postedAt).toBeNull();
  });
  it('reads processed lines, scores and pre-screen skips', () => {
    expect(p.processed[0]).toMatchObject({
      num: '096',
      company: 'Sense',
      score: 4.1,
      skipped: null,
    });
    expect(p.processed[1]).toMatchObject({ num: null, skipped: '7+ years required' });
  });
  it('reads the shortlist', () => {
    expect(p.shortlisted).toEqual([
      {
        url: 'https://jobs.ashbyhq.com/pleo/5',
        company: 'pleo',
        role: 'Marketing Operations Manager',
        location: '',
      },
    ]);
  });
});

describe('parseTracker', () => {
  it('finds columns by name and the report file', () => {
    const rows =
      parseTracker(`| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|-----|------|-------|--------|-----|--------|-------|
| 79 | 2026-10-23 | Grace Kelly Trust | — | Partnerships Manager | 3.2/5 | **Evaluated** | ❌ | [078](../reports/078-grace.md) | At salary floor. |`);
    expect(rows).toEqual([
      {
        num: '79',
        date: '2026-10-23',
        company: 'Grace Kelly Trust',
        via: '',
        role: 'Partnerships Manager',
        score: 3.2,
        status: 'Evaluated',
        reportFile: '078-grace.md',
        notes: 'At salary floor.',
      },
    ]);
  });
});

describe('parseReport', () => {
  const report = `# Evaluation: WaterAid — Philanthropy Manager

**Date:** 2026-10-23
**URL:** https://example.org/job
**Score:** 4.0/5
**Legitimacy:** High Confidence

**Verdict:** 4.0/5 — strong fit, pay at the floor.

## Machine Summary

\`\`\`yaml
company: "WaterAid"
role: "Philanthropy Manager"
score: 4.0
legitimacy_tier: "High Confidence"
hard_stops: []
soft_gaps:
  - "No individual major gifts"
top_strengths:
  - "Grant wins"
next_action: "Apply this week"
advertised_comp: "£41,325"
\`\`\`

**Score breakdown**

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Match with CV | 3.7 | Grants transfer |
| North Star alignment | 4.5 | Primary archetype |
| **Global** | 4.0 | Average |
`;
  const r = parseReport(report);
  it('reads the header and machine summary', () => {
    expect(r).toMatchObject({
      url: 'https://example.org/job',
      company: 'WaterAid',
      score: 4,
      verdictLine: 'strong fit, pay at the floor.',
      gaps: ['No individual major gifts'],
      strengths: ['Grant wins'],
      nextAction: 'Apply this week',
      comp: '£41,325',
    });
  });
  it('maps the score table to known dimensions and skips the global row', () => {
    expect(r.dimensions.map((d) => [d.key, d.score])).toEqual([
      ['cv', 3.7],
      ['north_star', 4.5],
    ]);
  });
});

describe('small files', () => {
  it('reads a JD cache file', () => {
    expect(parseJdCache('---\nurl: https://x.org/1\ncompany: "x"\n---\nThe job text.')).toEqual({
      url: 'https://x.org/1',
      body: 'The job text.',
    });
  });
  it('reads the discard log', () => {
    expect(
      parseDiscardLog('2026-10-23T10:00:00Z\thttps://x.org/2\tSales, not fundraising.\n'),
    ).toEqual([
      { at: '2026-10-23T10:00:00Z', url: 'https://x.org/2', reason: 'Sales, not fundraising.' },
    ]);
  });
  it('reads portals.yml rules', () => {
    const p = parsePortals(
      `title_filter:\n  positive: ["Grants"]\n  negative: ["Intern"]\nlocation_filter:\n  always_allow: ["London"]\nsalary_filter: { min: 35000, currency: GBP }\ntracked_companies:\n  - name: Acme\n    careers_url: https://jobs.lever.co/acme\nsearch_queries:\n  - name: Q\n    query: "grants london"\n    enabled: false\n`,
    );
    expect(p.rules.title).toEqual({ positive: ['Grants'], negative: ['Intern'] });
    expect(p.rules.salary).toEqual({ min: 35000, max: 0, currency: 'GBP' });
    expect(p.companies[0]?.name).toBe('Acme');
    expect(p.queries).toEqual([{ name: 'Q', query: 'grants london', enabled: false }]);
  });
  it('maps tracker statuses to lists', () => {
    expect(mapStatus('Evaluated')).toEqual({ list: 'scored' });
    expect(mapStatus('Interview')).toEqual({ list: 'applied', stage: 'interview' });
    expect(mapStatus('Rejected')).toEqual({ list: 'archive', reason: 'rejected' });
    expect(mapStatus('SKIP')).toEqual({ list: 'archive', reason: 'low_score' });
  });
});
