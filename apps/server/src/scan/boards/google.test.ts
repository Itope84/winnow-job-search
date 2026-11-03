import { describe, expect, it } from 'vitest';
import { googleOffer, googlePage, googleSearch } from './google.ts';

const job = [
  '126055959020610246',
  'Communications Manager, EMEA',
  'https://www.google.com/about/careers/applications/signin?jobId=x',
  [null, '<ul><li>Drive the strategy.</li></ul>'],
  [null, '<h3>Minimum qualifications:</h3><ul><li>A degree.</li></ul>'],
  'projects/x/companies/y',
  null,
  'DeepMind',
  'en-US',
  [['London, UK', ['123 Road'], 'London', 'SW1', 'England', 'GB'], ['Dublin, Ireland']],
  [null, '<p>About the team.</p>'],
  [2],
  [1793369616, 531000000],
];

describe('Google jobs', () => {
  it('keeps the link’s filters and drops its page number', () => {
    expect(
      googleSearch({
        name: 'Google',
        careers_url:
          'https://www.google.com/about/careers/applications/jobs/results?location=London%2C%20UK&q=sre&page=3',
      })?.toString(),
    ).toBe(
      'https://www.google.com/about/careers/applications/jobs/results/?location=London%2C+UK&q=sre',
    );
    expect(googleSearch({ name: 'G', careers_url: 'https://careers.google.com/' })).toBeNull();
  });

  it('reads the jobs and total from the page data', () => {
    const html = `<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([[job], null, 135, 20])}, sideChannel: {}});</script>`;
    const { jobs, total } = googlePage(html);
    expect(total).toBe(135);
    expect(googleOffer(jobs[0]!)).toMatchObject({
      title: 'Communications Manager, EMEA',
      url: 'https://www.google.com/about/careers/applications/jobs/results/126055959020610246-communications-manager-emea',
      company: 'DeepMind',
      location: 'London, UK · Dublin, Ireland',
      postedAt: 1793369616000,
    });
    expect(() => googlePage('<html></html>')).toThrow(/no job data/);
  });
});
