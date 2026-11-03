import type { PortalMatch } from '@winnow/api';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { confirm, lookAtPage } from '../scan/find-portal.ts';
import { loadProviders } from '../scan/providers.ts';
import { clip } from '../util.ts';
import { runSkill } from './run-skill.ts';

/**
 * Find careers feed, the AI step: when no scanner, directory or request of the page names the feed,
 * AI reads what the page loads, links to and says, and names the job system behind it. Winnow loads
 * what it names before offering it, so a wrong guess shows no jobs and is dropped.
 */
export async function findPortalRun(ctx: RunCtx): Promise<RunOutput> {
  const params = ctx.runs.params(ctx.run.id);
  const url = String(params.url ?? '');
  const name = String(params.name ?? '');
  ctx.step('Opening the page');
  const look = await lookAtPage(url);
  if (!look) throw new Error('The page didn’t open in the browser.');
  const { providers } = await loadProviders();
  ctx.step('Looking for the feed');
  const { value } = await runSkill(ctx, {
    skill: 'find-portal',
    input: {
      url,
      name,
      title: look.title,
      urlsFile: 'urls.txt',
      textFile: 'page.txt',
      scanners: [...providers.keys()],
    },
    files: { 'urls.txt': look.urls.join('\n'), 'page.txt': look.text },
    task: 'Name the job system feed behind this careers page, or say there is none.',
    model: ctx.settings.models.default,
    timeoutMs: 4 * 60_000,
    validate: (v) => {
      const o = v as { careers_url?: unknown; reason?: unknown };
      if (o?.careers_url !== null && typeof o?.careers_url !== 'string')
        throw new Error('result.json needs "careers_url": a link or null.');
      const link = typeof o.careers_url === 'string' ? o.careers_url.trim() : '';
      if (link && !/^https:\/\//.test(link))
        throw new Error('"careers_url" must be an https link.');
      return { link: link || null, reason: clip(String(o.reason ?? ''), 300) };
    },
    web: true,
  });
  let matches: PortalMatch[] = [];
  if (value.link) {
    ctx.step('Checking the feed');
    matches = (await confirm([{ name: name || 'Company', careers_url: value.link }], 'ai')).map(
      (m) => ({ ...m, entry: { ...m.entry, name: name || m.entry.name, enabled: true } }),
    );
  }
  return {
    summary: matches[0]
      ? `${matches[0].provider}: ${matches[0].jobs} jobs`
      : value.link
        ? 'AI named a feed, but no scanner could read it'
        : 'No feed found',
    result: { matches, reason: value.reason, title: look.title },
  };
}
