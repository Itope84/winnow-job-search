import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpace, type Space } from './space.ts';

/** A throwaway person's space in a temp folder. */
export function tempSpace(userId = 'test'): Space & { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'winnow-test-'));
  return { ...openSpace(join(root, 'users'), userId), root };
}
