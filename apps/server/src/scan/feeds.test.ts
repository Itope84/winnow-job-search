import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setSources } from '../library.ts';
import { tempSpace } from '../test-helpers.ts';
import { companyKey, dismissFeed, openFeeds, rememberFeed, seenCompanies } from './feeds.ts';

describe('companies seen in scans', () => {
  it('keys a company by its name without legal suffixes', () => {
    expect(companyKey('Acme Labs Ltd.')).toBe(companyKey('acme labs'));
  });

  it('suggests untracked companies seen 3+ times or scored well, never agencies or dismissed ones', () => {
    openFeeds(mkdtempSync(join(tmpdir(), 'winnow-feeds-')), '');
    const space = tempSpace();
    const add = (company: string, n: number, list: 'inbox' | 'scored' = 'inbox') => {
      for (let i = 0; i < n; i++)
        space.jobs.insert({
          url: `https://x.org/${company}/${i}`,
          company,
          role: `Role ${i}`,
          source: 'linkedin',
          list,
          movedBy: 'scan',
          addedBy: 'scan',
        });
    };
    add('Acme', 3);
    add('Beta', 1);
    add('Tracked Co', 4);
    add('Hays Recruitment', 5);
    add('Gone', 3);
    for (const name of ['Acme', 'Beta', 'Tracked Co', 'Hays Recruitment', 'Gone'])
      rememberFeed(name, {
        entry: { name, careers_url: `https://job-boards.greenhouse.io/${companyKey(name)}` },
        provider: 'greenhouse',
        how: 'link',
      });
    setSources(space.db, {
      companies: [
        { name: 'Tracked Co', careers_url: 'https://job-boards.greenhouse.io/trackedco' },
      ],
      boards: [],
      queries: [],
      rules: {
        title: { positive: [], negative: [] },
        location: { alwaysAllow: [], allow: [], block: [] },
        salary: { min: 0, max: 0, currency: '' },
      } as never,
    });
    dismissFeed(space, 'Gone');
    expect(seenCompanies(space).map((s) => [s.feed.company, s.jobs])).toEqual([['Acme', 3]]);
  });
});
