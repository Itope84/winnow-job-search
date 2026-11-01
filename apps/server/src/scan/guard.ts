/**
 * The posting check: a posting is someone else's text, read by an AI next to the person's CV. Hidden HTML
 * and invisible characters are removed; anything that reads like an instruction to an AI, or was spelled
 * so a person can't see it, becomes a warning on the job. A warning never drops a job: it's for the person.
 *
 * Ported from ai-job-search's `tools/posting_guard.py` (MIT, github.com/ai-job-search-dev/ai-job-search).
 * Its shell-command patterns (curl, ssh, `.env`) are left out: they are ordinary words in engineering ads.
 */

const ZERO_WIDTH = '​‌‍⁠⁡⁢⁣⁤';
const BIDI = '‎‏‪‫‬‭‮⁦⁧⁨⁩';
const BIDI_TAMPER = '‭‮⁦⁧⁨⁩';
const FORMAT = '­  ';
const BOM = '﻿';
const INVISIBLE = new RegExp(`[${ZERO_WIDTH}${BIDI}${FORMAT}${BOM}]`, 'gu');
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;
/** England, Scotland and Wales flags: the one proper use of tag characters. */
const RGI_TAG_FLAG =
  /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;
const VARIATION = /[︀-️\u{E0100}-\u{E01EF}]/gu;
const VARIATION_RUN = /[︀-️\u{E0100}-\u{E01EF}]{2,}/gu;

const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]*[1-9])|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?(?![\d.])|color\s*:\s*transparent|clip\s*:\s*rect\(\s*0|clip-path\s*:\s*inset\(\s*100%|(?:left|top|text-indent)\s*:\s*-\d{4,}px/i;
const COLLAPSED_BOX = /\b(?:max-)?(?:height|width)\s*:\s*0(?:\.0+)?(?:px|em|rem|%|pt)?(?![\d.])/i;
const CLIPPED = /\boverflow(?:-[xy])?\s*:\s*hidden\b/i;
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const VOID = new Set(
  'br img input meta link hr wbr source area base col embed param track'.split(' '),
);
const BLOCK = new Set(
  'p div li ul ol h1 h2 h3 h4 h5 h6 tr br section article header footer table thead tbody blockquote pre dd dt dl nav main aside figure form fieldset legend address hr td th option'.split(
    ' ',
  ),
);
const IMPLIED_END = new Set(['p', 'li', 'dd', 'dt', 'tr', 'td', 'th', 'option']);

const INSTRUCTIONS = [
  /\bignore (all|any|the|previous|prior|above|earlier)\b/i,
  /\b(disregard|forget)( all| any| the| your| my)? (previous|prior|above|earlier|preceding|initial|original|system) (instructions?|prompts?)\b/i,
  /\byou are (?:an?|the) (?:ai(?![\w-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)\b/i,
  /\bsystem prompt\b/i,
  /\b(do not|don['’]?t|never) (tell|inform) the user\b(?!['’]s)/i,
  /\b(do not|don['’]?t|never) (mention|reveal|disclose) (this|these|that|it|any of this|the (above|following|previous))\b[^.\n]{0,30}\bto the user\b/i,
  /\b(run|execute) the following (command|commands|script|code|shell|instruction|instructions|steps)\b/i,
  // "As an AI" flags, except a job title close behind ("As an AI Engineer", "as an AI/ML Researcher").
  /\bas an ai(?![\w-])(?![\s/&]+(?:[\w&/-]+\s+){0,3}?(?:engineer|developer|researcher|scientist|architect|specialist|lead|consultant|manager|analyst|intern|trainer|expert|strategist|designer|tester|owner|programmer)s?\b)/i,
  /^\s*(assistant|system|user)\s*:/i,
  /<\|/,
  /\[INST\]/,
  /###\s*(system|instruction)/i,
  /\btool_use\b|\bfunction_call\b/i,
];
const LINE_MAX = 200;
const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const unescape = (s: string) =>
  s
    .replace(/&#(\d+);?/g, (_m, n: string) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_m, n: string) => safeChar(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITY[n.toLowerCase()] ?? m);
const safeChar = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) out[(m[1] ?? '').toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

/** Hidden as a browser would hide it: the style read with entities decoded and CSS comments gone. */
function isHidden(raw: string): boolean {
  const a = attrs(raw);
  if ('hidden' in a || a['aria-hidden']?.trim().toLowerCase() === 'true') return true;
  const style = unescape(a.style ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  return HIDDEN_STYLE.test(style) || (COLLAPSED_BOX.test(style) && CLIPPED.test(style));
}

/**
 * The markup with hidden elements, comments and script-like blocks taken out, and the text they held.
 * Keeps a stack of open elements with HTML's implied end tags, so a stray closer can't end a hidden
 * element early and an unclosed `<li>` inside one can't swallow the rest of the page.
 */
export function stripHidden(markup: string): { html: string; hidden: string } {
  const hidden: string[] = [];
  const keep = (m: string) => {
    hidden.push(unescape(m.replace(/<!--|-->/g, ' ').replace(/<[^>]+>/g, ' ')));
    return ' ';
  };
  const pre = markup
    .replace(/<!DOCTYPE[^>]*>|<\?[^>]*\?>/gi, ' ')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, keep)
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, keep);

  const out: string[] = [];
  const buf: string[] = [];
  const stack: string[] = [];
  let hiddenAt: number | null = null;
  let pos = 0;
  const emit = (s: string) => (hiddenAt === null ? out : buf).push(s);
  const popTo = (i: number) => {
    stack.length = i;
    if (hiddenAt !== null && hiddenAt >= stack.length) {
      hidden.push(unescape(buf.join('').replace(/<[^>]+>/g, ' ')));
      buf.length = 0;
      hiddenAt = null;
    }
  };
  for (const m of pre.matchAll(TAG)) {
    emit(pre.slice(pos, m.index));
    pos = (m.index ?? 0) + m[0].length;
    const closing = m[1] === '/';
    const name = (m[2] ?? '').toLowerCase();
    if (closing) {
      const i = stack.lastIndexOf(name);
      if (i >= 0) {
        // The closer stays in the output only when the element it closes was visible.
        const visible = hiddenAt === null || i < hiddenAt;
        popTo(i);
        if (visible) emit(m[0]);
      }
      continue;
    }
    if (VOID.has(name)) {
      emit(m[0]);
      continue;
    }
    if (IMPLIED_END.has(name) && stack.at(-1) === name) popTo(stack.length - 1);
    else if (name !== 'br' && BLOCK.has(name) && stack.at(-1) === 'p') popTo(stack.length - 1);
    stack.push(name);
    if (hiddenAt === null && isHidden(m[3] ?? '')) hiddenAt = stack.length - 1;
    emit(m[0]);
  }
  emit(pre.slice(pos));
  if (hiddenAt !== null) popTo(hiddenAt);
  return { html: out.join(''), hidden: hidden.join('\n') };
}

/** Text without invisible characters, plus what they hid: counts that mean tampering, and decoded text. */
export function stripInvisible(text: string): {
  text: string;
  inWords: number;
  tags: number;
  spelled: string[];
} {
  const flags = text.match(RGI_TAG_FLAG) ?? [];
  const unflagged = text.replace(RGI_TAG_FLAG, '');
  const tags = [...unflagged.matchAll(TAG_RUN)].reduce((n, m) => n + [...m[0]].length, 0);
  let inWords = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (BIDI_TAMPER.includes(ch)) inWords++;
    else if (ZERO_WIDTH.includes(ch) || ch === BOM) {
      const before = chars[i - 1] ?? '';
      const after = chars[i + 1] ?? '';
      if (/\p{L}/u.test(before) && /\p{L}/u.test(after)) inWords++;
    }
  });
  const spelled: string[] = [];
  for (const m of unflagged.matchAll(TAG_RUN)) {
    const s = [...m[0]]
      .map((c) => (c.codePointAt(0) ?? 0) - 0xe0000)
      .filter((n) => n >= 0x20 && n < 0x7f)
      .map((n) => String.fromCharCode(n))
      .join('')
      .trim();
    if (s) spelled.push(s.slice(0, LINE_MAX));
  }
  for (const m of text.matchAll(VARIATION_RUN)) {
    const bytes = [...m[0]].map((c) => {
      const n = c.codePointAt(0) ?? 0;
      return n <= 0xfe0f ? n - 0xfe00 : n - 0xe0100 + 16;
    });
    const s = new TextDecoder()
      .decode(new Uint8Array(bytes))
      .replace(/[^\P{C}\n]/gu, '')
      .trim();
    if (s) spelled.push(s.slice(0, LINE_MAX));
  }
  // Keep the three flags whole; strip everything invisible around them.
  const strip = (s: string) => s.replace(VARIATION, '').replace(INVISIBLE, '').replace(TAG_RUN, '');
  let cleaned = '';
  let last = 0;
  for (const m of text.matchAll(RGI_TAG_FLAG)) {
    cleaned += strip(text.slice(last, m.index)) + m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  cleaned += strip(text.slice(last));
  return { text: flags.length ? cleaned : strip(text), inWords, tags, spelled };
}

/** Up to 200 characters of a line, always showing the match. */
function excerpt(line: string, at: number): string {
  if (line.length <= LINE_MAX) return line;
  const start = Math.max(0, Math.min(at - Math.floor(LINE_MAX / 3), line.length - LINE_MAX));
  const end = start + LINE_MAX;
  return `${start ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
}

/** Lines that read like instructions to an AI, from the visible text and from what was hidden. */
export function instructionLines(...texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of texts.join('\n').split('\n')) {
    const s = line.replace(/\s+/g, ' ').trim();
    if (!s || seen.has(s)) continue;
    for (const re of INSTRUCTIONS) {
      const m = re.exec(s);
      if (m) {
        seen.add(s);
        out.push(excerpt(s, m.index));
        break;
      }
    }
  }
  return out;
}

/** What the person sees on a job whose posting tried something. */
export function postingWarnings(text: string, hidden = ''): { text: string; warnings: string[] } {
  const visible = stripInvisible(text);
  const behind = stripInvisible(hidden);
  const warnings: string[] = [];
  const quote = (s: string) => `“${s}”`;
  for (const line of instructionLines(visible.text, behind.text).slice(0, 5))
    warnings.push(`Reads like an instruction to an AI: ${quote(line)}`);
  for (const s of [...visible.spelled, ...behind.spelled].slice(0, 3))
    warnings.push(`Text spelled in invisible characters: ${quote(s)}`);
  const inWords = visible.inWords + behind.inWords;
  if (inWords)
    warnings.push(
      `${inWords} invisible character${inWords === 1 ? '' : 's'} inside words, which can hide text from a check`,
    );
  const tags = visible.tags + behind.tags;
  if (tags && !visible.spelled.length && !behind.spelled.length)
    warnings.push(`${tags} tag character${tags === 1 ? '' : 's'}: text no reader can see`);
  return { text: visible.text, warnings };
}
