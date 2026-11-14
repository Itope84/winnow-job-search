---
name: profile-prefill
description: Read a Markdown CV and suggest the facts setup's forms ask for (contact details, target roles, level, places), taking only what the CV says.
---

# Profile pre-fill

A new person is setting up Winnow, a job-search app. They gave us their CV. You read it and suggest
answers for the setup forms so they don't have to type what the CV already says. They check every
suggestion before it is saved.

## Input

`input.json` in the run folder has:

- `cvFile`: `cv.md`, the CV in Markdown, a file in the run folder. Read all of it.

Read only `input.json` and `cv.md`. Do not browse the web. Do not open other files.

## Rules

1. **Take facts from the CV only.** If the CV doesn't say something, leave it as `""` or `[]`. Never guess
   a phone number, link, city or country.
2. **Roles** are the next jobs this person would most likely apply for, judged from their recent titles and
   the direction of their career: 3 to 6 titles, as a job advert would write them (for example
   "Grants Manager", not "grants and fundraising work").
   - `dream`: the most recent role or the obvious next step up from it.
   - `good`: roles they clearly have the experience for.
   - `stretch`: adjacent roles their experience could lead to.
3. **Level** is one short phrase for the seniority they would apply at, such as "Manager",
   "Senior / Lead" or "Associate / Coordinator".
4. **Places**: the city and country they are based in, as written on the CV (for example "London, UK").
   Add "Remote" only if the CV shows remote work.
5. **workTypes**: only `"remote"`, `"hybrid"` or `"onsite"`, and only when the CV says so; otherwise `[]`.
6. **currency**: the ISO code for the country they are based in (GBP for the UK, USD for the US, EUR for the
   euro area), or `""` if the CV gives no country.
7. **languages** (in `about`): the languages the CV lists, each with the level it gives, written like
   "English (native), French (B1)". Leave `""` when the CV lists none; don't infer one from where they live.

## Scholarships mode

When `input.mode` is `"scholarships"`, the person is looking for funded study, not a job:

- `roles` are the **programmes or fields of study** they would apply for next, judged from their degree,
  thesis, research interests and (when `statementFile` is set) their own statement in `statement.md`
  in the run folder. Write them as a university would ("MSc Molecular Medicine", "MSc Biomedical
  Sciences", "MSc Neuroscience"). `dream`: what their own words aim at; `good`: close fields their
  degree fits; `stretch`: neighbouring fields.
- `level`: the degree they'd apply for ("Master's").
- `places`: leave `[]`: where to study is asked separately.
- `about.nationality`: only if the CV or statement says it outright; otherwise `""`. Never infer it
  from where they studied or live.
- `workTypes` `[]`, `currency` `""`.

## Output

Write `result.json` in the run folder:

```json
{
  "about": {
    "name": "Ada Lovelace",
    "phone": "+44 7700 900123",
    "city": "London",
    "country": "United Kingdom",
    "linkedin": "https://www.linkedin.com/in/ada",
    "portfolio": "",
    "languages": "English (native), French (B1)"
  },
  "roles": [
    { "title": "Grants Manager", "fit": "dream" },
    { "title": "Programme Manager", "fit": "good" },
    { "title": "Partnerships Manager", "fit": "stretch" }
  ],
  "level": "Manager",
  "places": ["London, UK"],
  "workTypes": [],
  "currency": "GBP"
}
```

Then stop. Do not print the result in your reply.
