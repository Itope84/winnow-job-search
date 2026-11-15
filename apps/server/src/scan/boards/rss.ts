import type { SourceEntry } from '@winnow/api';
import { fetchFeed } from '../../study/feeds.ts';
import type { Offer } from '../intake.ts';
import type { BoardOffers, Provider } from '../providers.ts';
import { list } from './html.ts';

/**
 * A job board's RSS feed (`api`: the feed's address). Feeds rarely give a location, so `places` lists
 * the place names to look for in each item's title and description: the ones named become its location,
 * and an item naming none reaches triage, which reads the posting. `skip` lists title words that mark
 * an item as not a job (round-ups, adverts for courses).
 */
export function feedOffers(
  items: { title: string; url: string; description: string; publishedAt?: number }[],
  entry: SourceEntry,
): Offer[] {
  const places = list(entry.places);
  const skip = list(entry.skip).map((s) => s.toLowerCase());
  const named = (text: string) => {
    const lower = text.toLowerCase();
    return places.filter((p) =>
      new RegExp(`\\b${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower),
    );
  };
  return items
    .filter((i) => !skip.some((s) => i.title.toLowerCase().includes(s)))
    .map((i) => {
      // "Graduate Trainee at Acme Ltd" → role and company; a multi-role post keeps its whole title.
      const at = /^(.*\S)\s+at\s+(.+?)(?:\s*\(\d+\s+openings?\))?$/i.exec(i.title);
      const recruiting =
        /^(.+?)\s+(?:graduate\s*&\s*exp\.?\s+|graduate\s+|exp\.?\s+)?(?:job\s+)?recruitment\b/i.exec(
          i.title,
        );
      return {
        title: at ? (at[1] as string) : i.title,
        url: i.url,
        company: at
          ? (at[2] as string)
          : recruiting
            ? (recruiting[1] as string)
            : String(entry.name),
        location: named(`${i.title} ${i.description}`).join(', '),
        description: i.description,
        postedAt: i.publishedAt,
      };
    });
}

export const rssJobs: Provider = {
  id: 'rss',
  async fetch(entry) {
    const url = String(entry.api ?? entry.careers_url ?? '');
    if (!/^https?:\/\//.test(url)) throw new Error('This feed has no address (`api`).');
    const out: BoardOffers = feedOffers(await fetchFeed(url), entry);
    return out;
  },
};
