---
name: study-sources-suggest
description: Suggest scholarship pages to watch, news feeds and AI searches for one applicant looking for funded master's study.
---

# Suggest scholarship sources

Print progress lines: `[winnow] 1/4 Reading the profile`.

## Input

`input.json` in the run folder has `study` (subjects, level, nationality, places to prefer, allow and
exclude, English test, work experience, funding need), `cvFile` (the CV's start, in the run folder),
`alreadyListed` (pages and feeds Winnow will suggest anyway: don't repeat them) and `countries` (fact
cards for the places they prefer or allow).

## What to suggest

1. `pages`: up to 20 pages worth watching that aren't in `alreadyListed`. Mix:
   - universities' own scholarship or funding pages, at universities with strong master's programmes
     in the candidate's subjects in their preferred countries;
   - national or regional schemes open to their nationality (from `countries[].schemes` and `grants`);
   - foundations and societies in their field that fund master's study.
   Each must be the official page, open to their nationality and level, and not only for countries in
   `places.exclude`. Open each to check it loads and is current.
2. `feeds`: RSS feeds of scholarship news useful to them (for example a feed for their region or
   field). Only real feed URLs that you have opened.
3. `queries`: up to 6 web searches that would find what the pages miss, in plain words ("fully funded
   MSc molecular medicine Europe international students 2027").
4. `erasmusKeywords`: up to 12 lower-case word stems that pick their subjects out of Erasmus Mundus
   programme titles (for example `biomed`, `molecular`, `neuro`, `infect`, `vaccin`, `health`).

## Output

```json
{
  "pages": [
    {
      "name": "Karolinska Institutet scholarships",
      "url": "https://...",
      "kind": "university | scheme",
      "countries": ["Sweden"],
      "note": "Why it suits them, in one line."
    }
  ],
  "feeds": [ { "name": "...", "url": "https://.../feed/", "note": "..." } ],
  "queries": [ { "name": "Short label", "query": "the search" } ],
  "erasmusKeywords": ["biomed", "molecular"]
}
```

Write `result.json` in the run folder once, then stop.
