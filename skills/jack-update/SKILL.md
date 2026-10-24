---
name: jack-update
description: Compare a person's Winnow profile with their Jack (Jack & Jill) profile and search brief, and draft the edits that fill Jack's gaps, in the shape Jack's update tools take. Adds no facts.
---

# Jack update

The person uses Winnow, a job-search app, and has connected their account on Jack, an AI recruiter from
Jack & Jill. Jack has two parts:

- a **profile**, visible to hiring managers, filled from LinkedIn;
- a private **search brief** that steers Jack's job search and which Jill roles reach them.

Winnow already knows what the person wants. You draft the edits that bring Jack up to date. The person
reviews every edit before anything is sent.

## Input

Files in the run folder (`input.json` names them):

- `cv.md`: their CV in Markdown.
- `narrative.md`: their profile in their own words: who they are, what they want, strengths, deal-breakers.
- `profile.yml`: their targets: roles (archetypes with fit primary, secondary, adjacent), location,
  compensation (currency, target range, minimum), work preferences, deal-breakers.
- `jack-profile.json`: Jack's profile now. Text fields, skills, and `experiences` and `education`, each
  with its `key`. `improvements` lists what Jack thinks is missing.
- `jack-brief.json`: Jack's brief now, and the fields it lists as missing.

Read only these files. Do not browse the web. Do not open other files.

## Rules

1. **Add no facts.** Every edit comes from the CV, the narrative or `profile.yml`. Don't inflate ("led"
   when the CV says "supported"). If Winnow doesn't say something, leave that field alone.
2. **Fill gaps; don't overwrite the person.** Draft an edit when Jack's field is empty, or when Winnow
   clearly says something different (for example new target roles). Never remove or replace something
   Winnow doesn't contradict. If Jack already says the same thing, draft nothing for it.
3. **Keep the brief private.** Pay, exclusions and deal-breakers go only in the brief, never in the profile.
4. **Write plainly**, without buzzwords ("passionate", "results-driven"). Jack refuses profile text
   with first-person pronouns (I, me, my) or the person's name. Write profile text without pronouns
   ("Senior software engineer with 7+ years…", "Wants a senior role where…"); where one is needed, use
   they/them. Brief text (`role_priorities`, `company_profile`, notes) follows the same rule.
5. Give every edit a `why` of a few words saying where it comes from ("Your target roles in Winnow",
   "Your CV, Acme role").

### Brief edits

Use `op: "set"` with the whole value, except pay (below). Fields:

| Field | Value | From |
| --- | --- | --- |
| `role_titles` | list of job titles, as adverts write them | the roles in `profile.yml` |
| `role_areas` | list from: `software_engineering`, `data`, `other_engineering`, `product`, `design`, `operations_strategy`, `sales_account_management`, `marketing`, `people_hr_recruitment`, `finance_legal_compliance` | the roles |
| `seniority_levels` | list from: `internship`, `entry`, `junior`, `mid`, `senior`, `expert_leadership` | the level they target |
| `employment_types` | list from: `full_time`, `contract`, `part_time` | only if Winnow says |
| `locations` | list of places, such as "London, United Kingdom" | location and places |
| `work_modes` | list from: `remote`, `hybrid`, `on_site` | work preferences |
| `right_to_work_countries` | list of country names, such as "United Kingdom" | only if Winnow says |
| `pay` | `op: "add"`, value `{ "currency": "GBP", "floor": 80000, "target": 100000 }`, whole numbers per year | compensation; currency GBP, USD, CAD or EUR |
| `role_priorities` | 1–3 sentences: what matters most in the next role | narrative's North Star and what they want |
| `company_profile` | 1–2 sentences: the kind of company they want | narrative and preferences |
| `technologies` | list of the main technologies they want to keep using | the CV, for technical roles only |
| `excluded_role_titles`, `excluded_industries`, `excluded_companies` | lists | deal-breakers that name them |
| `location_notes`, `compensation_notes` | one sentence | only when there's a nuance a list can't hold |

### Profile edits

- `headline`, `summary`, `looking_for`: `op: "set"` with a string, written as rule 4 says. Headline:
  one phrase, at most 15 words. Summary: 2 to 4 sentences, for example "Senior software engineer with
  8 years in Go and Postgres. Led the move of Acme's billing to usage-based pricing." Looking for:
  one or two sentences, without pay, for example "A senior role building payments or developer
  infrastructure, owning work from design to production."

- `skills`: `op: "set"` with a list of 8 to 15 skills named in the CV.
- An experience with no description: `field: "experiences"`, `op: "update"`, `item_key` the entry's
  `key`, `value: { "description": "…" }`. Write 2 to 5 lines of `- ` bullets from that job in the CV.
  Match the entry to the CV by company and dates. Skip any entry you can't match with confidence.
- Don't add or remove experiences or education entries, and don't touch `links` or `location`.

## Output

Write `result.json` in the run folder:

```json
{
  "brief": [
    { "field": "role_titles", "op": "set", "value": ["Senior Software Engineer", "Staff Engineer"], "why": "Your target roles in Winnow" },
    { "field": "pay", "op": "add", "value": { "currency": "GBP", "floor": 70000, "target": 85000 }, "why": "Your pay in Winnow" }
  ],
  "profile": [
    { "field": "summary", "op": "set", "value": "…", "why": "Your story in Winnow" },
    { "field": "experiences", "op": "update", "item_key": "a1b2c3d4e5f6", "value": { "description": "- …" }, "why": "Your CV, Acme role" }
  ]
}
```

Either list may be empty. Then stop. Do not print the result in your reply.
