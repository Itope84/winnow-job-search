import { describe, expect, it } from 'vitest';
import { facet, jobsAcUk, jobsAcUkPage, jobsAcUkUrl, offeredFacets } from './jobs-ac-uk.ts';

const job = (id: string, title: string, placed = '06 Nov') => `
<div class="j-search-result__result ie-border-left" data-advert-id="${id}">
    <div class="j-search-result__text">
        <a href="/job/${id}/${title.toLowerCase().replace(/\W+/g, '-')}">
            ${title}
        </a>
        <div class="j-search-result__department">
            Department of Politics
        </div>
        <div class="j-search-result__employer">
            <b>University of Chester</b>
        </div>
        <div>Location:
            Chester
        </div>
        <div class="j-search-result__info">
            <strong>Salary: </strong>
                £40,704 to £44,352
        </div>
        <div>
            <strong>Date Placed: </strong>${placed}
        </div>
    </div>
</div>`;

const page = (n: number) =>
  `<div id="job-listings">${Array.from({ length: n }, (_, i) => job(`D${i}`, `Lecturer ${i}`)).join('')}</div>`;

describe('jobs.ac.uk', () => {
  it('turns places into the site’s location facets', () => {
    expect(facet('United Kingdom')).toBe('united-kingdom');
    expect(facet(' Zürich ')).toBe('zurich');
    const u = new URL(
      jobsAcUkUrl({ name: 'j', locations: ['united-kingdom'], location: 'London' }, 'lecturer', 3),
    );
    expect(u.searchParams.getAll('locationFacet[]')).toEqual(['united-kingdom', 'london']);
    expect(u.searchParams.get('keywords')).toBe('lecturer');
    expect(u.searchParams.get('startIndex')).toBe('51');
    expect(u.searchParams.get('sortOrder')).toBe('1');
  });

  it('reads a results page', () => {
    const got = jobsAcUkPage(page(1), Date.parse('2026-11-06T12:00:00Z'));
    expect(got).toEqual([
      {
        title: 'Lecturer 0',
        url: 'https://www.jobs.ac.uk/job/D0/lecturer-0',
        company: 'University of Chester',
        location: 'Chester',
        postedAt: Date.UTC(2026, 10, 6),
        salary: { text: '£40,704 to £44,352' },
      },
    ]);
  });

  it('puts a date with no year in the latest past one', () => {
    const got = jobsAcUkPage(
      `<div id="job-listings">${job('D1', 'Late', '28 Dec')}</div>`,
      Date.parse('2027-01-02T09:00:00Z'),
    );
    expect(got[0]?.postedAt).toBe(Date.UTC(2026, 11, 28));
  });

  it('accepts an empty search, and refuses a page it does not know', () => {
    expect(jobsAcUkPage('<div id="job-listings"></div>')).toEqual([]);
    expect(() => jobsAcUkPage('<html>Access denied</html>')).toThrow(/changed shape/);
  });

  it('reads a second page only when the first is full', async () => {
    const asked: string[] = [];
    const ctx = {
      fetchJson: async () => ({}),
      fetchText: async (url: string) => {
        asked.push(url);
        return asked.length === 1 ? page(25) : page(4);
      },
    };
    const got = await jobsAcUk.fetch({ name: 'j', max_pages: 3 }, ctx);
    expect(asked).toHaveLength(2);
    expect(new URL(asked[1] as string).searchParams.get('startIndex')).toBe('26');
    // The second page repeats the first four jobs, which are not counted twice.
    expect(got).toHaveLength(25);
  });

  it('says so when the site has no filter for a place, instead of finding nothing', async () => {
    const filters = ['united-kingdom', 'england', 'london']
      .map((v) => `<input type="checkbox" name="locationFacet[]" value="${v}">`)
      .join('');
    expect(offeredFacets(`${filters}<div id="job-listings"></div>`)).toEqual([
      'united-kingdom',
      'england',
      'london',
    ]);
    // A filtered page with no results has no filter list; the unfiltered one has.
    const ctx = {
      fetchJson: async () => ({}),
      fetchText: async (url: string) =>
        new URL(url).searchParams.has('locationFacet[]')
          ? '<div id="job-listings"></div>'
          : `${filters}<div id="job-listings">${job('D1', 'Lecturer')}</div>`,
    };
    await expect(jobsAcUk.fetch({ name: 'j', location: 'Leeds, UK' }, ctx)).rejects.toThrow(
      /no jobs\.ac\.uk filter for "leeds"/,
    );
    // A real filter with no jobs is an empty answer, not an error.
    expect(await jobsAcUk.fetch({ name: 'j', location: 'London' }, ctx)).toEqual([]);
  });
});
