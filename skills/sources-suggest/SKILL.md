---
name: sources-suggest
description: Suggest where a new person's jobs will come from (employers with careers pages, job-board searches, web search queries) and title keywords, for their target roles and places.
---

# Suggest sources

A new person is setting up Winnow, a job-search app. Winnow finds jobs in three ways, and you suggest a
starting set of each for this person. They untick what they don't want. Winnow then checks every
employer's careers page and drops the ones it can't read, so a wrong link only wastes a slot.

## Input

`input.json` in the run folder has:

- `roles`: target roles, each `{ title, fit }` (`dream`, `good` or `stretch`).
- `level`, `workTypes`, `places`, `currency`, `dealBreakers`.
- `cvFile`: `cv.md` in the run folder, the start of their CV, for their field and sector.
- `boardsAvailable`: the job-board providers this server can search (ids below). Use no others.

Read `input.json` and `cv.md`. You may use web search and fetch pages to find employers' careers pages. Keep it
brief: about 10 minutes at most. Print `[winnow] n/4 phase` lines as you go (1 employers, 2 boards,
3 queries, 4 titles).

## 1. Employers (`companies`, 10 to 25)

Organisations that hire for these roles in these places, as `{ name, careers_url, notes }`.

- Prefer employers whose jobs live on an applicant tracking system Winnow reads directly: Greenhouse
  (`https://job-boards.greenhouse.io/<slug>`), Lever
  (`https://jobs.lever.co/<slug>`), Ashby (`https://jobs.ashbyhq.com/<slug>`), Workable
  (`https://apply.workable.com/<slug>`), SmartRecruiters, Recruitee, Teamtailor, Personio, BambooHR,
  Breezy, Pinpoint, Workday. Open the page to confirm the link works and the slug is right.
- Mix large and small employers, and the sector the CV shows (for example charities and foundations for
  a fundraiser, fintechs for a payments engineer).
- `notes`: one line on why this employer fits.

## 2. Job-board searches (`boards`, 2 to 6)

Each is one saved search on a provider in `boardsAvailable`, with a `name` you choose, `"enabled": true`
and the provider's fields:

| provider | Good for | Fields |
| --- | --- | --- |
| `adzuna` | Keyword search in GB, US, CA, AU, DE, FR, NL, IN, and others (not Ireland) | `country` (2-letter, lower case), `what_or` (space-separated words, any match), `what_exclude`, `where` (a city), `distance` (km), `category` (Adzuna slug, e.g. `charity-voluntary-jobs`, `it-jobs`), `max_days_old`, `max_pages` (1–3), `results_per_page` (50) |
| `careerjet` | Keyword search, including Ireland | `locale_code` (e.g. `en_IE`, `en_GB`), `keywords`, `location` |
| `linkedin` | The biggest board, one page of results per search | `keywords`, `location`, `posted_within_days` |
| `remotive`, `remoteok`, `himalayas`, `weworkremotely`, `jobicy`, `workingnomads` | Remote jobs, mostly tech, product, marketing and operations | none |
| `themuse`, `arbeitnow`, `4dayweek` | General feeds (US-heavy, EU-heavy, four-day weeks) | none |

Pick keyword searches built from the target roles and places first. Add a remote feed only when the person
wants remote work and their field is one those feeds carry.

## 3. Web search queries (`queries`, 3 to 8)

Each is `{ name, query }`, a search-engine query that finds postings the boards miss, such as
`site:jobs.lever.co "Grants Manager" London` or `"Programme Officer" foundation remote UK`.

## 4. Title keywords (`titles`)

- `positive`: 10 to 30 words or phrases that appear in titles of jobs they would want (include the target
  role titles and close variants).
- `negative`: 5 to 20 that mark jobs they would never want (other fields with similar words, levels they
  ruled out, unpaid work). Never put a word here that appears in a target role.

## Output

Write `result.json` in the run folder:

```json
{
  "companies": [{ "name": "Acumen", "careers_url": "https://job-boards.greenhouse.io/acumen", "notes": "Impact investor with London grants roles" }],
  "boards": [{ "name": "Adzuna: London grants", "provider": "adzuna", "country": "gb", "what_or": "grants fundraising partnerships", "where": "london", "distance": 40, "max_days_old": 21, "max_pages": 2, "results_per_page": 50, "enabled": true }],
  "queries": [{ "name": "Lever: grants roles in London", "query": "site:jobs.lever.co \"Grants Manager\" London" }],
  "titles": { "positive": ["Grants", "Fundraising"], "negative": ["Intern", "Volunteer"] }
}
```

Then stop. Do not print the result in your reply.
