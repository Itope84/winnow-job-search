import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadProviders, resolveEntry } from '../../apps/server/src/scan/providers.ts';

const here = new URL('.', import.meta.url).pathname;
const rd = (f: string, d: any = {}) =>
  existsSync(here + f) ? JSON.parse(readFileSync(here + f, 'utf8')) : d;
const companies = Object.fromEntries(rd('companies.json').companies.map((c: any) => [c.id, c]));
const dir = rd('directory-hits.json'),
  fps = rd('fingerprints.json'),
  pages = rd('pages.json');
const { makeHttpCtx } = await loadProviders();
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
async function load(url: string, name: string, tries = 2) {
  for (let i = 0; i < tries; i++) {
    const entry = { name, careers_url: url, max_pages: 1 } as any;
    const hit = await resolveEntry(entry);
    if ('error' in hit) return null;
    let t: any;
    try {
      const offers: any = await Promise.race([
        hit.provider.fetch(entry, makeHttpCtx()),
        new Promise((_, rej) => {
          t = setTimeout(() => rej(new Error('timeout')), 30_000);
        }),
      ]);
      const arr = Array.isArray(offers) ? offers : [];
      if (arr.length)
        return {
          portal: hit.provider.id,
          url,
          jobs: arr.length,
          sample: arr.slice(0, 3).map((o: any) => String(o.title ?? '').trim()),
        };
    } catch {
    } finally {
      clearTimeout(t);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}
const extra: Record<string, any> = rd('extras.json');
// (1) directory misses that had candidates
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const missed = Object.entries(dir)
  .filter(([id, d]: any) => d.candidates > 0 && !d.hits.length)
  .map(([id]) => id);
console.log('directory rechecks', missed.length);
// rebuild candidates quickly via the same resolve-directories logic is overkill: re-run it for these ids only
// (1b) URL mining from pages whose HTML names a driveable job system
const PATS: RegExp[] = [
  /https?:\/\/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[A-Za-z0-9_.-]+/g,
  /https?:\/\/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/[a-z0-9_-]+/gi,
  /https?:\/\/jobs\.lever\.co\/[a-z0-9_.-]+/gi,
  /https?:\/\/jobs\.ashbyhq\.com\/[a-z0-9_.-]+/gi,
  /https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/[A-Za-z0-9_.-]+/g,
  /https?:\/\/apply\.workable\.com\/[a-z0-9_-]+/gi,
  /https?:\/\/[a-z0-9-]+\.avature\.net\/[A-Za-z0-9_\/-]+/gi,
  /https?:\/\/[a-z0-9-]+\.csod\.com\/ux\/ats\/careersite\/\d+\/home\?c=[a-z0-9-]+/gi,
];
const ids = Object.entries(fps)
  .filter(
    ([, v]: any) =>
      !v.supported &&
      v.fingerprints?.some((f: string) =>
        [
          'workday',
          'greenhouse',
          'lever',
          'ashby',
          'smartrecruiters',
          'workable',
          'avature',
          'csod',
        ].includes(f),
      ),
  )
  .map(([id]) => id);
console.log('mine urls for', ids.length);
for (const id of ids) {
  if (extra[id]) continue;
  try {
    const r = await fetch(fps[id].page, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
      headers: { 'user-agent': UA },
    });
    const html = await r.text();
    const urls = [...new Set(PATS.flatMap((re) => html.match(re) ?? []))]
      .filter((u) => !/embed|\/api\//.test(u))
      .slice(0, 5);
    for (const u of urls) {
      const ok = await load(u.replace(/\/$/, ''), companies[id].name);
      if (ok) {
        extra[id] = ok;
        break;
      }
    }
  } catch {}
}
writeFileSync(here + 'extras.json', JSON.stringify(extra, null, 1));
console.log(
  'mined hits',
  Object.keys(extra).length,
  Object.values(extra)
    .map(
      (e: any) => companies[Object.keys(extra).find((k) => extra[k] === e)!].name + ':' + e.portal,
    )
    .join(', '),
);
process.exit(0);
