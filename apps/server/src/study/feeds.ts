import { decodeEntities, text } from '../scan/boards/html.ts';
import { BROWSER_UA } from '../scan/capture.ts';

export interface FeedItem {
  title: string;
  url: string;
  description: string;
  publishedAt: number | undefined;
}

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return '';
  return (m[1] ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
};

/** The items of an RSS 2.0 or Atom feed. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks
    .map((b) => {
      const atomLink = /<link\b[^>]*href="([^"]+)"/i.exec(b)?.[1];
      const url = decodeEntities(tag(b, 'link') || atomLink || tag(b, 'guid')).trim();
      const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
      const t = Date.parse(date);
      return {
        title: text(decodeEntities(tag(b, 'title'))),
        url,
        description: text(
          decodeEntities(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')),
        ),
        publishedAt: Number.isFinite(t) ? t : undefined,
      };
    })
    .filter((i) => i.title && /^https?:\/\//.test(i.url));
}

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const items = parseFeed(await res.text());
  if (!items.length) throw new Error('No items: this doesn’t look like a feed.');
  return items;
}

/**
 * Whether a news item is about funding or a programme a master's seeker could use. Feeds mix in jobs,
 * conferences and undergraduate awards; those are dropped here, before any AI reads them.
 */
export function studyRelevant(item: FeedItem, level = 'master'): boolean {
  const t = `${item.title} ${item.description.slice(0, 400)}`.toLowerCase();
  if (
    !/scholarship|fellowship|bursar|grant|funded|stipend|award|master|msc|postgraduate|graduate/.test(
      t,
    )
  )
    return false;
  const title = item.title.toLowerCase();
  if (
    /\b(job|vacancy|internship|conference|competition|hackathon|webinar|call for papers)\b/.test(
      title,
    )
  )
    return false;
  // Round-ups ("Top 10+ Scholarships for Women") name many calls and none in full.
  if (/^(top\s+)?\d+\+?\s/.test(title) || /^top\s/.test(title)) return false;
  const onlyUndergrad =
    /undergraduate|bachelor/.test(t) &&
    !/master|postgraduate|\bgraduate\b|\bmsc\b|\bmres\b/.test(t);
  if (/master/.test(level) && onlyUndergrad) return false;
  return true;
}
