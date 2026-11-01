import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Profile } from './library.ts';

describe('Not on your CV', () => {
  const dirs: string[] = [];
  const profile = () => {
    const dir = mkdtempSync(join(tmpdir(), 'winnow-lib-'));
    dirs.push(dir);
    return { dir, profile: new Profile(dir) };
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('adds each line as a bullet after what is there', () => {
    const { dir, profile: p } = profile();
    expect(p.get().extras).toBe('');
    p.addExtra('On-call for six years');
    p.set({ extras: `${p.get().extras}\nWritten by hand.\n` });
    p.addExtra('  Led incident reviews\nacross three teams ');
    expect(readFileSync(join(dir, 'profile/extras.md'), 'utf8')).toBe(
      '- On-call for six years\n\nWritten by hand.\n- Led incident reviews across three teams\n',
    );
  });

  it('refuses an empty line', () => {
    expect(() => profile().profile.addExtra('  \n ')).toThrow('Write what you have.');
  });
});
