import { describe, expect, it } from 'vitest';
import { nhsJobs, nhsPage, nhsPlace, nhsUrl } from './nhs-jobs.ts';

const result = (ref: string, title: string, posted = '29 October 2026') => `
    <li class="nhsuk-list-panel search-result nhsuk-u-padding-3"
        data-test="search-result"
    >
      <h2 class="nhsuk-heading-m" id="job-title-1">
        <a href="/candidate/jobadvert/${ref}?keyword=nurse&amp;location=London&amp;language=en"
            id="first-result-title"
            data-test="search-result-job-title"
        >
          ${title}
        </a>
      </h2>
      <div class="nhsuk-u-margin-bottom-4" data-test="search-result-location">
        <h3 class="nhsuk-u-font-weight-bold">
          The Confederation, Hillingdon CIC
          <div class="location-font-size">
              Ruislip HA4 8NX,
              Uxbridge UB8 1UW
          </div>
        </h3>
      </div>
      <ul class="ad-job-info nhsuk-list first-ad-job-info">
          <li data-test="search-result-salary" class="marginBt">
            Salary:
            <strong class="nhsuk-u-font-weight-bold">
              &pound;33,262 to &pound;36,027 a year
            </strong>
          </li>
          <li data-test="search-result-publicationDate">
            Date posted:
            <strong class="nhsuk-u-font-weight-bold">
              ${posted}
            </strong>
          </li>
      </ul>
    </li>`;

const page = (n: number, total = n) =>
  `<html><body><h2>${total} jobs found</h2><ul class="nhsuk-list search-results">${Array.from(
    { length: n },
    (_, i) => result(`E0004-26-${String(i).padStart(4, '0')}`, `Nurse ${i}`),
  ).join('')}</ul></body></html>`;

describe('NHS Jobs', () => {
  it('builds the search: newest first, distance only with a place', () => {
    const u = new URL(nhsUrl({ name: 'n', location: 'London', distance: 5 }, 'data analyst', 2));
    expect(u.searchParams.get('keyword')).toBe('data analyst');
    expect(u.searchParams.get('location')).toBe('London');
    expect(u.searchParams.get('distance')).toBe('5');
    expect(u.searchParams.get('sort')).toBe('publicationDateDesc');
    expect(u.searchParams.get('page')).toBe('2');
    const bare = new URL(nhsUrl({ name: 'n' }, '', 1));
    expect(bare.searchParams.has('keyword')).toBe(false);
    expect(bare.searchParams.has('distance')).toBe(false);
    expect(bare.searchParams.has('page')).toBe(false);
  });

  it('reads a results page', () => {
    const got = nhsPage(page(2, 1143), Date.parse('2026-11-06T12:00:00Z'));
    expect(got.total).toBe(1143);
    expect(got.offers).toHaveLength(2);
    expect(got.offers[0]).toEqual({
      title: 'Nurse 0',
      url: 'https://www.jobs.nhs.uk/candidate/jobadvert/E0004-26-0000',
      company: 'The Confederation, Hillingdon CIC',
      location: 'Ruislip HA4 8NX, Uxbridge UB8 1UW',
      postedAt: Date.UTC(2026, 9, 29),
      salary: { text: '£33,262 to £36,027 a year' },
    });
  });

  it('accepts the page for a search with no results, and refuses one it does not know', () => {
    expect(nhsPage('<title>No search results found - NHS Jobs</title>').offers).toEqual([]);
    expect(() => nhsPage('<html>Quick check needed</html>')).toThrow(/changed shape/);
  });

  it('reads the pages of each keyword, drops repeats, and says when it stopped short', async () => {
    const asked: string[] = [];
    const ctx = {
      fetchJson: async () => ({}),
      fetchText: async (url: string) => {
        asked.push(url);
        // Every search shows the same first 10 jobs, so the second keyword adds nothing new.
        return page(10, 55);
      },
    };
    const got = await nhsJobs.fetch({ name: 'NHS', keywords: 'nurse, midwife', max_pages: 1 }, ctx);
    expect(asked).toHaveLength(2);
    expect(got).toHaveLength(10);
    expect(got.note).toMatch(/of 55/);
  });

  it('stops at a short page', async () => {
    let calls = 0;
    const ctx = {
      fetchJson: async () => ({}),
      fetchText: async () => (calls++, page(3, 3)),
    };
    expect(await nhsJobs.fetch({ name: 'NHS', max_pages: 5 }, ctx)).toHaveLength(3);
    expect(calls).toBe(1);
  });

  it('drops words that mean "no place", keeps real ones', () => {
    for (const w of ['Remote', 'remote', 'UK', 'United Kingdom', 'England', ' Wales '])
      expect(nhsPlace(w)).toBe('');
    expect(nhsPlace(' Leeds ')).toBe('Leeds');
    expect(nhsPlace(undefined)).toBe('');
    expect(
      new URL(nhsUrl({ name: 'n', location: 'Remote' }, 'nurse', 1)).searchParams.has('location'),
    ).toBe(false);
  });

  it('knows the "Location not found" page from a changed one', () => {
    const notFound =
      '<title>Job search results - NHS Jobs</title><h2>Location not found</h2>We could not find an exact match for';
    expect(nhsPage(notFound)).toMatchObject({ offers: [], unknownPlace: true });
    expect(() => nhsPage('<title>Something new - NHS Jobs</title><p>hi</p>')).toThrow(
      /changed shape \(titled "Something new - NHS Jobs"\)/,
    );
  });

  it('tries the part before the comma when NHS does not know "Leeds, UK"', async () => {
    const places: string[] = [];
    const ctx = {
      fetchJson: async () => ({}),
      fetchText: async (url: string) => {
        const place = new URL(url).searchParams.get('location') ?? '';
        places.push(place);
        return place === 'Leeds, UK'
          ? '<title>Job search results - NHS Jobs</title>Location not found'
          : page(2, 2);
      },
    };
    const got = await nhsJobs.fetch({ name: 'NHS', location: 'Leeds, UK', keywords: 'a, b' }, ctx);
    expect(got).toHaveLength(2);
    // The first search finds "Leeds"; the second keyword goes straight there.
    expect(places).toEqual(['Leeds, UK', 'Leeds', 'Leeds']);
  });

  it('says what is wrong when no form of the place is known', async () => {
    const ctx = {
      fetchJson: async () => ({}),
      fetchText: async () => 'Location not found',
    };
    await expect(nhsJobs.fetch({ name: 'NHS', location: 'Lagos' }, ctx)).rejects.toThrow(
      /place "Lagos" not found.*leave the place empty/,
    );
  });
});
