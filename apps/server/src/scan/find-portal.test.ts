import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromDirectories, namesFor } from './find-portal.ts';

describe('careers feed finder', () => {
  it('names the company from its domain and page title', () => {
    expect(namesFor('https://www.acme.com/careers/jobs/')).toEqual(['acme']);
    expect(namesFor('https://careers.acme.co.uk/', ['Careers at Acme Labs | Acme'])).toEqual([
      'acme',
      'acmelabs',
    ]);
  });

  it('matches directory names exactly or as a regional board, and skips dead ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'winnow-ats-'));
    writeFileSync(
      join(dir, 'greenhouse.json'),
      JSON.stringify(['acme', 'acme-eu', 'acmetrade', 'other']),
    );
    writeFileSync(join(dir, 'lever.json'), JSON.stringify(['acme']));
    for (const ats of ['ashby', 'workday']) writeFileSync(join(dir, `${ats}.json`), '[]');
    writeFileSync(join(dir, 'dead-boards.json'), JSON.stringify({ 'lever:acme': Date.now() }));
    const found = await fromDirectories(dir, ['acme']);
    expect(found.map((e) => e.careers_url)).toEqual([
      'https://job-boards.greenhouse.io/acme',
      'https://job-boards.greenhouse.io/acme-eu',
    ]);
  });
});
