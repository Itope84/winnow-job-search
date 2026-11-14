// Re-test suspicious "supported" rows (empty sample / vendor asset URLs) using the real careers page + explicit provider hints.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadProviders } from '../../apps/server/src/scan/providers.ts';

const here = new URL('.', import.meta.url).pathname;
const cat = JSON.parse(readFileSync(here + 'catalogue.json', 'utf8')).companies;
const pages = JSON.parse(readFileSync(here + 'pages.json', 'utf8'));
const { providers, makeHttpCtx } = await loadProviders();
const bad = cat.filter(
  (c: any) =>
    c.status === 'supported' &&
    (!c.sample?.length || /cdn\.phenompeople|app\.teamtailor|oneclick-ui/.test(c.careersUrl)),
);
console.log('suspicious', bad.length);
async function test(prov: string, name: string, url: string) {
  const p = providers.get(prov);
  if (!p) return null;
  const entry = { name, careers_url: url, provider: prov, max_pages: 1 } as any;
  let t: any;
  try {
    const offers: any = await Promise.race([
      p.fetch(entry, makeHttpCtx()),
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error('timeout')), 45_000);
      }),
    ]);
    const arr = (Array.isArray(offers) ? offers : []).filter((o: any) =>
      String(o.title ?? '').trim(),
    );
    return arr.length
      ? { jobs: arr.length, sample: arr.slice(0, 3).map((o: any) => String(o.title).trim()) }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
const out: Record<string, any> = {};
const queue = [...bad];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const c = queue.shift();
      const page = pages[c.id]?.page;
      if (!page) {
        out[c.id] = { fail: true };
        continue;
      }
      for (const prov of [
        c.portal,
        'phenom',
        'successfactors',
        'radancy',
        'smartrecruiters',
        'teamtailor',
      ]) {
        if (['teamtailor', 'smartrecruiters'].includes(prov) && prov !== c.portal) continue;
        const r = await test(prov, c.name, page);
        if (r) {
          out[c.id] = { portal: prov, url: page, ...r };
          break;
        }
      }
      if (!out[c.id]) out[c.id] = { fail: true };
    }
  }),
);
writeFileSync(here + 'hints.json', JSON.stringify(out, null, 1));
console.log(
  'recovered',
  Object.values(out).filter((o: any) => !o.fail).length,
  'failed',
  Object.values(out).filter((o: any) => o.fail).length,
);
process.exit(0);
