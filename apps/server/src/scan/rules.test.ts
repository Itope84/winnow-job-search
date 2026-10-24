import { describe, expect, it } from 'vitest';
import { EMPTY_RULES } from '../library.ts';
import { compileRules } from './rules.ts';

const rules = compileRules({
  ...EMPTY_RULES,
  title: {
    positive: ['Fundraising', 'Programme Manager', 'Grants', 'Trusts'],
    negative: ['Intern', 'Trustee', 'Engineer'],
  },
  location: {
    alwaysAllow: ['London'],
    allow: ['Remote', 'United Kingdom'],
    block: ['US Remote', 'Remote, US'],
  },
  salary: { min: 35000, max: 0, currency: 'GBP' },
  maxAgeDays: 21,
});

describe('title rule', () => {
  it('keeps a title with a role word, plural included', () => {
    expect(rules.title('Head of Fundraising')).toBeNull();
    expect(rules.title('Senior Trusts and Grants Manager')).toBeNull();
  });
  it('drops a title with no role word', () => {
    expect(rules.title('Account Executive')).toMatch(/none of your roles/);
  });
  it('lets an excluded word win over a role word', () => {
    expect(rules.title('Trustee - Fundraising Committee')).toMatch(/trustee/);
  });
  it('matches short words as whole words only', () => {
    expect(rules.title('International Grants Officer')).toBeNull();
  });
});

describe('location rule', () => {
  it('always-allow rescues a multi-location post that also names a blocked place', () => {
    expect(rules.location('London or US Remote')).toBeNull();
  });
  it('blocks and explains', () => {
    expect(rules.location('US Remote')).toMatch(/blocked/);
  });
  it('requires an allowed place when there is an allow list', () => {
    expect(rules.location('Berlin, Germany')).toMatch(/outside your locations/);
  });
  it('passes when the location is unknown', () => {
    expect(rules.location('')).toBeNull();
    expect(rules.location('Location unknown')).toBeNull();
  });
});

describe('allowed places as setup writes them', () => {
  const mine = compileRules({
    ...EMPTY_RULES,
    location: { alwaysAllow: [], allow: ['London, UK', 'Remote'], block: [] },
  });
  it('matches the city however the ad writes it', () => {
    for (const place of [
      'London',
      'London (Hybrid)',
      'London, England, United Kingdom',
      'London Area, United Kingdom',
      'London, Birmingham · In-person',
      'London, Edinburgh, or Glasgow, hybrid',
      'London, UK (Hybrid - Tue/Wed/Thu in office)',
    ])
      expect(mine.location(place), place).toBeNull();
  });
  it('matches a posting that only names the country', () => {
    expect(mine.location('United Kingdom')).toBeNull();
    expect(mine.location('UK (Hybrid)')).toBeNull();
    expect(mine.location('United Kingdom · Dublin · Ireland · Spain')).toBeNull();
    expect(mine.location('Ireland; United Kingdom (Remote)')).toBeNull();
  });
  it('matches remote however the ad writes it', () => {
    for (const place of ['Home based - EMEA', 'Anywhere in the World', 'Remote - UK'])
      expect(mine.location(place), place).toBeNull();
  });
  it('drops remote limited to other regions, but not open or mixed ones', () => {
    for (const place of [
      'Home Based - Americas',
      'Home Based - Americas; Home Based - APAC',
      'Remote, US',
    ])
      expect(mine.location(place), place).toMatch(/outside your locations/);
    for (const place of [
      'Home Based - Americas; Home based - EMEA',
      'Home based - Worldwide',
      'Remote (Europe)',
    ])
      expect(mine.location(place), place).toBeNull();
    // With no home country, any remote job passes.
    const anywhere = compileRules({
      ...EMPTY_RULES,
      location: { alwaysAllow: [], allow: ['Remote'], block: [] },
    });
    expect(anywhere.location('Home Based - Americas')).toBeNull();
  });
  it('still drops other places, and whole words only', () => {
    for (const place of [
      'Manchester, United Kingdom',
      'New York, New York, USA',
      'Londonderry',
      'Paris, France',
    ])
      expect(mine.location(place), place).toMatch(/outside your locations/);
  });
});

describe('pay and age rules', () => {
  it('drops pay entirely below the floor', () => {
    expect(rules.salary({ min: 25000, max: 30000, currency: 'GBP' })).toMatch(
      /under your £35k floor/,
    );
  });
  it('passes a range that reaches the floor, and unstated pay', () => {
    expect(rules.salary({ min: 30000, max: 38000, currency: 'GBP' })).toBeNull();
    expect(rules.salary(null)).toBeNull();
  });
  it('drops another currency', () => {
    expect(rules.salary({ min: 90000, max: 120000, currency: 'USD' })).toMatch(/USD/);
  });
  it('drops old postings and passes undated ones', () => {
    expect(rules.age(Date.now() - 40 * 86_400_000)).toMatch(/21 days/);
    expect(rules.age(undefined)).toBeNull();
  });
});
