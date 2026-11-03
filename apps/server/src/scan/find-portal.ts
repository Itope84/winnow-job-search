import type { PortalMatch, SourceEntry } from '@winnow/api';
import { ATS, type Ats, companyList, loadDead, toEntry } from './ats.ts';
import { BROWSER_UA, sharedBrowser } from './capture.ts';
import { loadProviders, resolveEntry } from './providers.ts';

/**
 * Find the job system behind a careers page, so a company can be scanned from its feed. In order: a
 * scanner that reads the link as it is; the Greenhouse, Lever, Ashby and Workday company directories,
 * by the company's name; the requests and links the page makes in a headless browser. Each find is
 * loaded once, so the person sees how many jobs it has before saving it. No AI: that is `find_portal`.
 */

/** Boards search everyone's jobs; a company's own feed is what we're after. */
const BOARDS = new Set(['linkedin', 'freehire', 'adzuna', 'careerjet', 'remotive', 'remoteok']);
const MAX_PER_STEP = 4;

/** How many jobs an entry's feed has now, or null when it doesn't load. */
async function countJobs(entry: SourceEntry, timeoutMs = 20_000): Promise<number | null> {
  const hit = await resolveEntry(entry);
  if ('error' in hit || BOARDS.has(hit.provider.id)) return null;
  const { makeHttpCtx } = await loadProviders();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const offers = await Promise.race([
      hit.provider.fetch(entry, makeHttpCtx()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
      }),
    ]);
    return Array.isArray(offers) ? offers.length : 0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Load each entry and keep those that answer, as matches. */
export async function confirm(
  entries: SourceEntry[],
  how: PortalMatch['how'],
): Promise<PortalMatch[]> {
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const k = String(e.api ?? e.careers_url);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const out: PortalMatch[] = [];
  await Promise.all(
    unique.slice(0, MAX_PER_STEP * 2).map(async (entry) => {
      const hit = await resolveEntry(entry);
      if ('error' in hit) return;
      const jobs = await countJobs(entry);
      if (jobs !== null) out.push({ entry, provider: hit.provider.id, jobs, how });
    }),
  );
  return out.sort((a, b) => b.jobs - a.jobs);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The names a company probably goes by: from its domain, the name typed, and the page title. */
export function namesFor(url: string, extra: (string | null | undefined)[] = []): string[] {
  const out = new Set<string>();
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.');
    const skip = new Set(['www', 'careers', 'jobs', 'apply', 'join', 'work', 'talent', 'hire']);
    // The label before the public suffix: careers.acme.co.uk → acme.
    const main = labels.filter((l) => !skip.has(l));
    const tld = main.length > 2 && main.at(-2)!.length <= 3 ? 2 : 1;
    const name = main.at(-1 - tld);
    if (name) out.add(squash(name));
  } catch {}
  for (const e of extra) {
    // "Careers at Acme | Acme" → "acme": the shortest named part is usually the brand.
    const parts = String(e ?? '')
      .split(/[|·–—:-]|\bcareers?\b|\bjobs?\b|\bat\b/i)
      .map(squash)
      .filter((p) => p.length >= 3);
    for (const p of parts) out.add(p);
  }
  return [...out].filter((n) => n.length >= 3);
}

/** Directory entries whose name is the company's, or starts with it ("acme", "acme-eu"); not dead. */
export async function fromDirectories(cacheDir: string, names: string[]): Promise<SourceEntry[]> {
  if (!names.length) return [];
  const dead = loadDead(cacheDir);
  const out: SourceEntry[] = [];
  for (const ats of ATS as Ats[]) {
    const raw = await companyList(cacheDir, ats);
    const exact: SourceEntry[] = [];
    const prefix: SourceEntry[] = [];
    for (const r of raw) {
      const entry = toEntry(ats, r);
      if (!entry || dead.has(`${ats}:${entry.name}`)) continue;
      const slug = squash(ats === 'workday' ? String(r).split('|')[0]! : entry.name);
      if (names.includes(slug)) exact.push(entry);
      else if (names.some((n) => n.length >= 4 && slug.startsWith(n) && slug.length - n.length <= 6))
        prefix.push(entry);
    }
    out.push(...exact, ...prefix.slice(0, 2));
  }
  return out.slice(0, MAX_PER_STEP * 2);
}

export interface PageLook {
  title: string | null;
  /** Requests the page made and links on it, outside the page's own site first. */
  urls: string[];
}

/** Open the page in a headless browser and note every request it makes and every link and frame. */
export async function lookAtPage(url: string): Promise<PageLook | null> {
  const browser = await sharedBrowser().catch(() => null);
  if (!browser) return null;
  const page = await browser.newPage({ userAgent: BROWSER_UA });
  const requests = new Set<string>();
  page.on('request', (r) => {
    if (['document', 'xhr', 'fetch', 'script'].includes(r.resourceType())) requests.add(r.url());
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    const links = await page
      .$$eval('a[href], iframe[src]', (els) =>
        els.map((e) => (e as HTMLAnchorElement).href || (e as HTMLIFrameElement).src),
      )
      .catch(() => [] as string[]);
    const title = await page.title().catch(() => null);
    const home = new URL(url).hostname.split('.').slice(-2).join('.');
    const all = [...requests, ...links].filter((u) => /^https?:/.test(u));
    const away = all.filter((u) => !new URL(u).hostname.endsWith(home));
    return { title, urls: [...new Set([...away, ...all])].slice(0, 400) };
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Entries a scanner recognises among the page's requests and links. */
export async function fromPage(look: PageLook): Promise<SourceEntry[]> {
  const out: SourceEntry[] = [];
  for (const url of look.urls) {
    for (const entry of [{ careers_url: url }, { api: url }]) {
      const e = { name: 'Company', ...entry };
      const hit = await resolveEntry(e);
      if ('error' in hit || BOARDS.has(hit.provider.id)) continue;
      out.push(e);
      break;
    }
    if (out.length >= MAX_PER_STEP * 2) break;
  }
  return out;
}

/** Every step but AI, cheapest first; stops at the first that finds a feed with jobs. */
export async function findPortal(
  cacheDir: string,
  url: string,
  name?: string,
): Promise<{ matches: PortalMatch[]; title: string | null }> {
  // A feed found only as an API link keeps the page it came from, so the list still shows it.
  const label = (e: SourceEntry) => ({
    ...e,
    name: name?.trim() || e.name,
    careers_url: e.careers_url ?? url,
    enabled: true,
  });
  const direct = await confirm([{ name: name || 'Company', careers_url: url }], 'direct');
  if (direct.length) return { matches: direct.map((m) => ({ ...m, entry: label(m.entry) })), title: null };

  const look = await lookAtPage(url);
  const names = namesFor(url, [name, look?.title]);
  const byName = await confirm(await fromDirectories(cacheDir, names), 'directory');
  const fromLook = look ? await confirm(await fromPage(look), 'page') : [];
  // What the page itself loads beats a name match.
  const matches = [...fromLook, ...byName.filter((m) => !fromLook.some((f) => same(f, m)))];
  return { matches: matches.map((m) => ({ ...m, entry: label(m.entry) })), title: look?.title ?? null };
}

/** The same feed found two ways (a directory link and the API the page calls): same scanner, same jobs. */
const same = (a: PortalMatch, b: PortalMatch) => a.provider === b.provider && a.jobs === b.jobs;
