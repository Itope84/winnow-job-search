import type { SetupRole, SourceEntry } from '@winnow/api';
import { decodeEntities, list, pause, text } from '../scan/boards/html.ts';
import { BROWSER_UA } from '../scan/capture.ts';

export const ERASMUS_CATALOGUE =
  'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en';

export interface CatalogueProgramme {
  title: string;
  url: string;
}

/** The programme cards on one page of the Erasmus Mundus catalogue. */
export function parseCataloguePage(html: string): CatalogueProgramme[] {
  const out: CatalogueProgramme[] = [];
  const re =
    /<div class="ecl-content-block__title">\s*<a href="([^"]+)"[^>]*>\s*<span class="ecl-link__label">([\s\S]*?)<\/span>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const url = decodeEntities(m[1] ?? '').trim();
    const title = text(m[2] ?? '');
    if (title && /^https?:\/\//.test(url)) out.push({ title, url });
  }
  return out;
}

/** The last page number in the catalogue's pager (`?page=11`), or 0. */
export function lastPage(html: string): number {
  let max = 0;
  for (const m of html.matchAll(/href="\?page=(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

const STOP = new Set([
  'master',
  'masters',
  'msc',
  'mres',
  'mphil',
  'science',
  'sciences',
  'studies',
  'programme',
  'program',
  'degree',
  'joint',
  'international',
  'advanced',
  'applied',
  'and',
  'the',
]);

/**
 * Words to pick programmes by: the entry's own keywords, else word stems from the subjects the person
 * wants ("Molecular Medicine" → "molecu", "medici"). Stems catch "Biomedical" and "Biomedicine" alike.
 */
export function subjectStems(entry: SourceEntry, subjects: SetupRole[]): string[] {
  const own = list(entry.keywords).map((k) => k.toLowerCase());
  if (own.length) return own;
  const words = subjects
    .flatMap((s) => s.title.toLowerCase().split(/[^a-z]+/))
    .filter((w) => w.length >= 5 && !STOP.has(w));
  return [...new Set(words.map((w) => w.slice(0, 6)))];
}

export function matches(title: string, stems: string[]): boolean {
  if (!stems.length) return true;
  const t = title.toLowerCase();
  return stems.some((s) => t.includes(s));
}

/** Every programme in the catalogue: it lists about 20 a page. */
export async function readCatalogue(
  url = ERASMUS_CATALOGUE,
  onPage?: (page: number, of: number) => void,
): Promise<CatalogueProgramme[]> {
  const get = async (page: number) => {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}page=${page}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  };
  const first = await get(0);
  const last = Math.min(lastPage(first), 40);
  const all = parseCataloguePage(first);
  onPage?.(1, last + 1);
  for (let p = 1; p <= last; p++) {
    await pause(300);
    all.push(...parseCataloguePage(await get(p)));
    onPage?.(p + 1, last + 1);
  }
  const seen = new Set<string>();
  return all.filter((x) => !seen.has(x.url) && seen.add(x.url));
}
