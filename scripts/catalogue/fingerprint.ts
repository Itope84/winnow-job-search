// Step C: classify "own site" careers pages by the vendor fingerprints in their HTML, then test branded
// providers (phenom, successfactors, radancy, avature, smartrecruiters, csod) with an explicit provider hint.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadProviders } from '../../apps/server/src/scan/providers.ts';

const here = new URL('.', import.meta.url).pathname;
const pages = JSON.parse(readFileSync(here + 'pages.json', 'utf8'));
const companies = Object.fromEntries(
  JSON.parse(readFileSync(here + 'companies.json', 'utf8')).companies.map((c: any) => [c.id, c]),
);
const FP: [string, string, RegExp][] = [
  // [platform, winnow provider or '', regex]
  ['phenom', 'phenom', /phenompeople|phenom\.com|ph-widget|"phenomExperience|cdn\.phenompeople/i],
  [
    'successfactors',
    'successfactors',
    /successfactors\.(com|eu)|jobs2web|rmkcdn|\/tile-search-results|\/services\/recruiting\/v1\/jobs/i,
  ],
  ['radancy', 'radancy', /talentbrew|tbcdn\.talentbrew|radancy|\/search-jobs/i],
  ['avature', 'avature', /\.avature\.net/i],
  ['smartrecruiters', 'smartrecruiters', /smartrecruiters\.com/i],
  ['csod', 'csod', /csod\.com/i],
  ['workday', 'workday', /myworkdayjobs\.com/i],
  ['icims', '', /icims\.com/i],
  ['taleo', '', /taleo\.net/i],
  ['oracle-recruiting', '', /oraclecloud\.com|\/hcmUI\/CandidateExperience/i],
  ['eightfold', '', /eightfold\.ai/i],
  ['brassring', '', /brassring\.com/i],
  ['jobvite', '', /jobvite\.com/i],
  ['ukg', '', /ultipro\.com|ukg\.net/i],
  ['greenhouse', 'greenhouse', /greenhouse\.io/i],
  ['lever', 'lever', /lever\.co\//i],
  ['ashby', 'ashby', /ashbyhq\.com/i],
  ['workable', 'workable', /workable\.com/i],
];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const { providers, makeHttpCtx } = await loadProviders();
const out: Record<string, any> = existsSync(here + 'fingerprints.json')
  ? JSON.parse(readFileSync(here + 'fingerprints.json', 'utf8'))
  : {};
const todo = Object.entries(pages)
  .filter(
    ([id, p]: any) =>
      p.status === 'unsupported' &&
      ['own-site-or-unrecognised', 'unknown'].includes(p.platform) &&
      !(id in out),
  )
  .map(([id]) => id);
console.log('to classify', todo.length);
async function testHint(prov: string, name: string, url: string) {
  const p = providers.get(prov);
  if (!p) return null;
  const entry = { name, careers_url: url, provider: prov, max_pages: 1 } as any;
  let t: any;
  try {
    const offers: any = await Promise.race([
      p.fetch(entry, makeHttpCtx()),
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error('timeout')), 40_000);
      }),
    ]);
    const arr = Array.isArray(offers) ? offers : [];
    return arr.length
      ? { jobs: arr.length, sample: arr.slice(0, 3).map((o: any) => String(o.title ?? '').trim()) }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
let n = 0;
async function worker() {
  while (todo.length) {
    const id = todo.shift()!;
    const c = companies[id];
    const page = pages[id].page;
    try {
      const r = await fetch(page, {
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
        headers: { 'user-agent': UA },
      });
      const html = (await r.text()).slice(0, 1_500_000);
      const hits = FP.filter(([, , re]) => re.test(html)).map(([pl]) => pl);
      const rec: any = { page: r.url, fingerprints: hits };
      // order: vendor job systems we can drive with a hint first
      for (const [pl, prov] of FP) {
        if (
          !prov ||
          !hits.includes(pl) ||
          ['greenhouse', 'lever', 'ashby', 'workday', 'workable'].includes(pl)
        )
          continue;
        const ok = await testHint(prov, c.name, r.url);
        if (ok) {
          rec.supported = { portal: prov, hint: true, url: r.url, ...ok };
          break;
        }
      }
      out[id] = rec;
    } catch (e) {
      out[id] = { fingerprints: [], error: String(e).slice(0, 80) };
    }
    if (++n % 20 === 0) {
      writeFileSync(here + 'fingerprints.json', JSON.stringify(out, null, 1));
      console.log(n);
    }
  }
}
await Promise.all(Array.from({ length: 5 }, worker));
writeFileSync(here + 'fingerprints.json', JSON.stringify(out, null, 1));
const t: Record<string, number> = {};
for (const v of Object.values(out) as any[]) {
  const k = v.supported ? 'supported:' + v.supported.portal : (v.fingerprints?.[0] ?? 'none');
  t[k] = (t[k] ?? 0) + 1;
}
console.log(t);
process.exit(0);
