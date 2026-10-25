import { type Db, kvGet, kvSet } from '../db.ts';
import { getSettings } from '../library.ts';
import type { Runner } from '../runs/runner.ts';
import type { Space } from '../space.ts';
import { canonicalUrl } from '../util.ts';
import { type JackLink, structured } from './jack.ts';

/**
 * Checking Jack on its own. Jill roles appear whenever a company posts with Jill, so the radar is read
 * every 10 minutes (one light call) and a scan starts only when there's a role Winnow hasn't seen. Jack's
 * own matching refreshes daily, and each search lands on the person's Jack dashboard, so the searches run
 * every 6 hours. A failed check waits an hour.
 */
export const JACK_AUTO = {
  checkMs: 10 * 60_000,
  searchMs: 6 * 3_600_000,
  retryMs: 3_600_000,
};

interface AutoState {
  lastCheck: number;
  lastSearch: number;
  waitUntil: number;
}

const KV = 'jack_auto';
const state = (db: Db) =>
  ({
    lastCheck: 0,
    lastSearch: 0,
    waitUntil: 0,
    ...kvGet<Partial<AutoState>>(db, KV, {}),
  }) as AutoState;
const save = (db: Db, patch: Partial<AutoState>) => kvSet(db, KV, { ...state(db), ...patch });

/** A scan just searched (automatic or not): the next automatic search waits its turn. */
export function markSearched(db: Db, at = Date.now()) {
  save(db, { lastSearch: at });
}

/** One check for one person. Returns what it started, if anything. */
export async function jackAutoTick(
  space: Space,
  runner: Runner,
  jack: JackLink,
  now = Date.now(),
): Promise<'full' | 'radar' | null> {
  const db = space.db;
  const settings = getSettings(db);
  if (!settings.jackAuto) return null;
  const link = jack.status(db);
  if (!link.connected || link.problem) return null;
  const s = state(db);
  if (now < s.waitUntil || now - s.lastCheck < JACK_AUTO.checkMs) return null;
  if (runner.store.list({ active: true }).some((r) => r.kind === 'scan_jack')) return null;
  save(db, { lastCheck: now });
  const options = { autoTriage: settings.autoTriage, auto: true };
  try {
    if (now - s.lastSearch >= JACK_AUTO.searchMs) {
      runner.enqueue({ kind: 'scan_jack', options });
      return 'full';
    }
    const radar = structured(await jack.call(db, 'get_radar_roles'));
    const roles = Array.isArray(radar.roles) ? (radar.roles as { jack_url?: string }[]) : [];
    const seen = db.prepare('SELECT 1 FROM scan_history WHERE canon_url = ?');
    const fresh = roles.some(
      (r) => r.jack_url && !space.jobs.byUrl(r.jack_url) && !seen.get(canonicalUrl(r.jack_url)),
    );
    if (!fresh) return null;
    runner.enqueue({ kind: 'scan_jack', options: { ...options, radarOnly: true } });
    return 'radar';
  } catch (e) {
    save(db, { waitUntil: now + JACK_AUTO.retryMs });
    console.error(`[${space.userId}] Jack check failed: ${(e as Error).message}`);
    return null;
  }
}
