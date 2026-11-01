import { describe, expect, it } from 'vitest';
import { fromProfile, spokenLanguages } from './setup.ts';

describe('spoken languages', () => {
  it('splits what the person typed into one language each', () => {
    expect(spokenLanguages('English (native), French (B1); Yoruba and Spanish (basic)')).toEqual([
      'English (native)',
      'French (B1)',
      'Yoruba',
      'Spanish (basic)',
    ]);
  });

  it('reads them back from profile.yml for Set up again', () => {
    expect(
      fromProfile({ language: { output: 'en', spoken: ['English (native)', 'French (B1)'] } }).about
        .languages,
    ).toBe('English (native), French (B1)');
    expect(fromProfile({ language: { output: 'en' } }).about.languages).toBe('');
  });
});
