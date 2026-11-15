import { describe, expect, it } from 'vitest';
import { feedOffers } from './rss.ts';

const entry = {
  name: 'Feed',
  provider: 'rss',
  places: ['Lagos', 'Abuja', 'Kano'],
  skip: ['Top 10'],
};

describe('feedOffers', () => {
  it('splits role and company, reads places from the text, and drops skipped titles', () => {
    const got = feedOffers(
      [
        {
          title: 'Graduate Trainee at Acme Nigeria Limited',
          url: 'https://x.ng/1',
          description: 'Based in Lagos.',
        },
        {
          title: 'Area Sales Manager at Med-In Pharmaceutical Limited (6 Openings)',
          url: 'https://x.ng/2',
          description: 'Located in Kano and Abuja.',
        },
        {
          title: 'Med-In Pharmaceutical Limited Graduate & Exp. Job Recruitment (10 Positions)',
          url: 'https://x.ng/3',
          description: 'Lagos, Ogun',
        },
        { title: 'Top 10 jobs this week', url: 'https://x.ng/4', description: '' },
        { title: 'QC Analyst at Lagosian Foods', url: 'https://x.ng/5', description: 'Hiring now' },
      ],
      entry,
    );
    expect(got.map((o) => [o.title, o.company, o.location])).toEqual([
      ['Graduate Trainee', 'Acme Nigeria Limited', 'Lagos'],
      ['Area Sales Manager', 'Med-In Pharmaceutical Limited', 'Abuja, Kano'],
      [
        'Med-In Pharmaceutical Limited Graduate & Exp. Job Recruitment (10 Positions)',
        'Med-In Pharmaceutical Limited',
        'Lagos',
      ],
      // "Lagosian" is not Lagos: whole words only.
      ['QC Analyst', 'Lagosian Foods', ''],
    ]);
  });
});
