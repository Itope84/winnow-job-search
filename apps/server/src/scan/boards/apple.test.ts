import { describe, expect, it } from 'vitest';
import { appleOffer, appleSearch } from './apple.ts';

describe('Apple jobs', () => {
  it('reads the search from an Apple link', () => {
    expect(
      appleSearch({
        name: 'Apple',
        careers_url:
          'https://jobs.apple.com/en-gb/search?location=london-LND+cambridge-CMA&key=swift',
      }),
    ).toEqual({
      locale: 'en-gb',
      query: 'swift',
      locations: ['postLocation-LND', 'postLocation-CMA'],
    });
    expect(
      appleSearch({ name: 'A', careers_url: 'https://jobs.apple.com/search' })?.locations,
    ).toEqual([]);
    expect(appleSearch({ name: 'A', careers_url: 'https://www.apple.com/careers/' })).toBeNull();
  });

  it('turns a result into a job with its link and places', () => {
    expect(
      appleOffer(
        {
          positionId: '200673803',
          postingTitle: 'Software Engineer ',
          transformedPostingTitle: 'software-engineer',
          postDateInGMT: '2026-11-02T10:00:00Z',
          locations: [
            { name: 'London', countryName: 'United Kingdom' },
            { name: 'United Kingdom', countryName: 'United Kingdom' },
          ],
        },
        'en-gb',
      ),
    ).toMatchObject({
      title: 'Software Engineer',
      url: 'https://jobs.apple.com/en-gb/details/200673803/software-engineer',
      company: 'Apple',
      location: 'London, United Kingdom · United Kingdom',
      postedAt: Date.parse('2026-11-02T10:00:00Z'),
    });
  });
});
