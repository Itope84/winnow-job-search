import { describe, expect, it } from 'vitest';
import { jobbermanPage, jobbermanUrl, postedAgo } from './jobberman.ts';

const NOW = Date.UTC(2026, 10, 14);
const card = (slug: string, title: string, company: string, place: string, pay = '') => `
<article class="mb-4" data-cy="listing-cards-components" aria-labelledby="job-1-title">
  <h3 id="job-1-title"><a
    href="https://www.jobberman.com/listings/${slug}" class="x" data-cy="listing-title-link" title="${title}">${title}</a></h3>
  <p class="flex"><span class="truncate text-text-secondary">${company}</span></p>
  <span class="inline-flex"><span class="x"><svg><path d="M0"/></svg></span> Posted 2 weeks ago </span>
  <div class="px-4"><div class="rounded-2xl" data-cy="description-tile"><p>Consulting &amp; strategy - An entry-level role.</p></div></div>
  <div class="flex flex-wrap items-end gap-4 px-4"> <span class="inline-flex">${place}</span> <span class="inline-flex"><svg></svg>Full Time</span> ${pay ? `<span class="inline-flex">${pay}</span>` : ''} </div>
</article>`;

describe('Jobberman', () => {
  it('reads each card: role, company, place, pay and age', () => {
    const html = `<main>${card('graduate-trainee-7jgmzd', 'Graduate Trainee', 'Macsfix Ltd', 'Lagos', 'NGN 150,000 - 250,000')}${card('qc-analyst-1', 'QC Analyst', 'Acme Foods', 'Ogun')}</main>`;
    expect(jobbermanPage(html, NOW)).toEqual([
      {
        title: 'Graduate Trainee',
        url: 'https://www.jobberman.com/listings/graduate-trainee-7jgmzd',
        company: 'Macsfix Ltd',
        location: 'Lagos',
        description: 'Consulting & strategy - An entry-level role.',
        postedAt: NOW - 14 * 86_400_000,
        salary: { text: 'NGN 150,000 - 250,000', currency: 'NGN' },
      },
      expect.objectContaining({ title: 'QC Analyst', location: 'Ogun', salary: undefined }),
    ]);
  });

  it('builds search links and says when the page changed shape', () => {
    expect(jobbermanUrl({ name: 'J', location: 'Lagos' }, 'graduate trainee', 2)).toBe(
      'https://www.jobberman.com/jobs?q=graduate+trainee&l=lagos&page=2',
    );
    expect(() => jobbermanPage('<html>nothing here</html>')).toThrow(/changed shape/);
    expect(postedAgo('Posted yesterday', NOW)).toBe(NOW - 86_400_000);
  });
});
