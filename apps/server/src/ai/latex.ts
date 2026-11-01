import { execFile } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { clip } from '../util.ts';

const run = promisify(execFile);

/** What Winnow found when it compiled one LaTeX file: the facts the review and revise steps work from. */
export interface TexCheck {
  file: string;
  ok: boolean;
  /** The compiler's own error lines when it failed. */
  error: string | null;
  pages: number | null;
  /** How far down the last page the text reaches, 0 to 1. */
  lastPageFill: number | null;
  /** Pages that end early, and text an applicant tracking system would misread. */
  problems: string[];
  /** The PDF's text layer as an applicant tracking system reads it, in a file next to the PDF. */
  textFile: string | null;
}

const TECTONIC = () => process.env.WINNOW_TECTONIC_BIN ?? 'tectonic';
const POPPLER = (tool: string) =>
  process.env.WINNOW_POPPLER_DIR ? join(process.env.WINNOW_POPPLER_DIR, tool) : tool;

/** Tectonic's error lines, without its download and rerun notes. */
export function texErrors(output: string): string {
  const lines = output.split('\n').filter((l) => /^(error|!)|\.tex:\d+:/i.test(l.trim()));
  return clip((lines.length ? lines : output.trim().split('\n').slice(-12)).join('\n'), 1500);
}

/** Text a reader can't see but a parser can: lost glyphs, and dates joined by an en dash. */
export function textProblems(text: string, mustContain: string[]): string[] {
  const out: string[] = [];
  if (/\(cid:\d+\)|�/.test(text))
    out.push(
      'Some characters come out as garbage in the text layer (a font without a text mapping).',
    );
  const dashed = text.match(/\b(19|20)\d{2}\s*[–—]\s*((19|20)\d{2}|present|now)\b/gi);
  if (dashed)
    out.push(
      `Date ranges joined by an en dash, which applicant trackers misread: ${[...new Set(dashed)].slice(0, 3).join(', ')}. Use a single hyphen in the date.`,
    );
  for (const s of mustContain)
    if (s && !text.toLowerCase().includes(s.toLowerCase()))
      out.push(`"${s}" is missing from the text layer (only in a link or icon?).`);
  return out;
}

/**
 * How far down each page the text reaches, as a share of the page, from `pdftotext -bbox` output. A page
 * number in the footer ("2/2", "Page 2") doesn't count.
 */
export function pageFills(bbox: string): number[] {
  return bbox
    .split('<page ')
    .slice(1)
    .map((page) => {
      const height = Number(/height="([\d.]+)"/.exec(page)?.[1]);
      if (!height) return 0;
      const bottoms = [...page.matchAll(/yMax="([\d.]+)"[^>]*>([^<]*)</g)]
        .filter(
          ([, y, word]) =>
            !(Number(y) > height * 0.88 && /^(page|of|\d+(\/\d+)?)$/i.test((word ?? '').trim())),
        )
        .map(([, y]) => Number(y));
      return bottoms.length ? Math.round((Math.max(...bottoms) / height) * 100) / 100 : 0;
    });
}

/** A page before the last that ends early: an entry too big for the space left jumped to the next page. */
export function layoutProblems(fills: number[]): string[] {
  return fills
    .slice(0, -1)
    .flatMap((f, i) =>
      f < 0.8
        ? [
            `Page ${i + 1} ends at ${Math.round(f * 100)}% of the page: the entry after the gap was too long to fit and moved to page ${i + 2}. Shorten it or the entries before it.`,
          ]
        : [],
    );
}

/**
 * Compile `file` in `folder` with Tectonic (it downloads missing packages on first use, so the first run
 * can take minutes), then read the PDF the way an applicant tracking system does.
 */
export async function compileTex(
  folder: string,
  file: string,
  opts: { mustContain?: string[]; signal?: AbortSignal } = {},
): Promise<TexCheck> {
  const pdf = join(folder, file.replace(/\.tex$/, '.pdf'));
  rmSync(pdf, { force: true });
  const check: TexCheck = {
    file,
    ok: false,
    error: null,
    pages: null,
    lastPageFill: null,
    problems: [],
    textFile: null,
  };
  try {
    await run(TECTONIC(), ['-X', 'compile', file], {
      cwd: folder,
      timeout: 6 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      signal: opts.signal,
    });
  } catch (e) {
    const err = e as { code?: string; stderr?: string; stdout?: string; message: string };
    if (err.code === 'ENOENT')
      throw new Error('Tectonic is not installed on the server (brew install tectonic).');
    if (opts.signal?.aborted) throw new Error('Cancelled');
    check.error = texErrors(`${err.stderr ?? ''}\n${err.stdout ?? ''}` || err.message);
  }
  if (!existsSync(pdf)) {
    check.error ??= 'Tectonic wrote no PDF.';
    return check;
  }
  check.ok = !check.error;
  const info = await run(POPPLER('pdfinfo'), [pdf]).catch(() => null);
  const pages = Number(/^Pages:\s*(\d+)/m.exec(info?.stdout ?? '')?.[1]);
  check.pages = Number.isFinite(pages) && pages > 0 ? pages : null;
  const text = await run(POPPLER('pdftotext'), ['-layout', '-enc', 'UTF-8', pdf, '-']).catch(
    () => null,
  );
  if (text) {
    check.textFile = pdf.replace(/\.pdf$/, '.txt');
    writeFileSync(check.textFile, text.stdout);
    check.problems = textProblems(text.stdout, opts.mustContain ?? []);
  }
  const bbox = await run(POPPLER('pdftotext'), ['-bbox', pdf, '-'], {
    maxBuffer: 16 * 1024 * 1024,
  }).catch(() => null);
  if (bbox) {
    const fills = pageFills(bbox.stdout);
    check.lastPageFill = fills.at(-1) ?? null;
    check.problems.push(...layoutProblems(fills));
  }
  return check;
}
