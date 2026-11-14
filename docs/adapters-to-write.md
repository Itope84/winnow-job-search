# Adapters we should write

Prepared 6 November 2026 from `docs/company-catalogue.json` (767 companies, built in `scripts/catalogue/`). The catalogue
says which companies Winnow can already scan (333 of 767) and, for the rest, which job system blocks us.
This file turns that into a build order. It is about **breadth**: one adapter for a job system unlocks every
company on it, so it beats one adapter for one company.

Everything here about how a site works is **from public knowledge and a quick look, not tested**, unless it
says "checked". Each adapter starts with an hour of looking at the real site before any code.

## Already done in this change

| Board              | Adapter                     | State                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NHS Jobs           | `scan/boards/nhs-jobs.ts`   | Checked live: reads results pages, 10 a page, newest first, searched by place.                                                                                                                                                                                                                                                                                          |
| jobs.ac.uk         | `scan/boards/jobs-ac-uk.ts` | Checked live: 25 a page, newest first, filtered by the site's location facets.                                                                                                                                                                                                                                                                                          |
| ReliefWeb          | none                        | **Not built, on purpose.** Its API needs an appname from a request form that says it is for content partners, and its RSS feed is disallowed by robots.txt (`Disallow: /*/rss.xml`). Winnow is neither a partner nor allowed to read the feed, and scraping the HTML pages would go against both. Worth asking them whether a personal job-search tool can have access. |
| Civil Service Jobs | none                        | **Blocked on purpose.** The site shows an "I'm not a robot" check before any page, to every automated visitor. We do not automate past a human check. See "Civil Service Jobs" below.                                                                                                                                                                                   |

NHS Jobs and jobs.ac.uk appear in Find › Job boards under "Available boards", switched off; switching one on adds a saved search
filled from the person's title words and place.

## 1. Job systems: one adapter, many companies

Winnow's readers match a link by its host. A company on its own domain (`jobs.acme.com`) needs an explicit
`provider:` in its entry, which is why the catalogue marks those `providerHint`.

| Job system        | Companies waiting | Adapter           | What to do                                          |
| ----------------- | ----------------- | ----------------- | --------------------------------------------------- |
| oracle-recruiting | 35                | none              | **Build first.**                                    |
| radancy           | 15                | exists (vendored) | Verify with a hint on each; 15 were not confirmed.  |
| icims             | 14                | none              | Build second.                                       |
| eightfold         | 8                 | none              | Build third; small and clean.                       |
| successfactors    | 8                 | exists (vendored) | Verify with a hint; 8 were not confirmed.           |
| avature           | 7                 | exists (vendored) | Verify with a hint.                                 |
| taleo             | 6                 | none              | Tenant-specific; build only if the others are done. |
| jobvite           | 2                 | none              | Low.                                                |
| adp               | 2                 | none              | Low.                                                |
| csod              | 2                 | exists (vendored) | Verify.                                             |
| paycom            | 1                 | none              | Skip.                                               |
| dayforce          | 1                 | none              | Skip.                                               |

Plus **243 companies on their own site or a system I could not name.** That is the long tail; see section 2.

### Who is waiting on each missing adapter

- **oracle-recruiting** (35): Oracle, Uber, Texas Instruments, Dell Technologies, Fortinet, Nokia, e&, JPMorgan Chase, JPMorgan, Lazard, Schroders, Chubb, Grant Thornton, Pinsent Masons, Providence, Mayo Clinic, Spire Healthcare, Oracle Health (Cerner), ITV, Pearson, Norwegian Refugee Council, IOM, UN Women, Honeywell Aerospace, Heathrow Airport, First Solar, Honeywell, Emerson, Cummins, Emaar, Kroger, Marks & Spencer, Marriott, Hilton, DP World
- **icims** (14): AMD, Arm, AXA, State Farm, Aon, H&R Block, CommonSpirit Health, Universal Health Services, Medpace, HarperCollins, Rivian, Costco, Allied Universal, Paychex
- **eightfold** (8): Qualcomm, Lam Research, Boston Scientific, Lockheed Martin, Eaton, Fluor, Haleon, Starbucks
- **taleo** (6): Kaiser Permanente, UnitedHealth Group, Qatar Airways, easyJet, Mercedes-Benz, D.R. Horton
- **jobvite** (2): Singtel, Mercy Corps
- **adp** (2): DAI Global, Rockefeller Foundation

### How each is believed to work (verify first)

- **Oracle Recruiting Cloud.** Career sites sit on `*.oraclecloud.com` (or a branded host) and call a public JSON REST
  resource, `/hcmRestApi/resources/latest/recruitingCEJobRequisitions`, with a site number and a `finder` in the query. No login.
  Biggest prize: JPMorgan Chase, Oracle, Uber, Marriott, Hilton, Kroger, Marks & Spencer, Honeywell and more.
- **iCIMS.** Customer portals at `careers-<company>.icims.com`; the search page is HTML with the list in an iframe
  (`?in_iframe=1`). I know of no stable JSON feed, so this is a page parser, which is more fragile.
- **Eightfold.** `<company>.eightfold.ai/careers` calls a JSON endpoint (`/api/apply/v2/jobs?domain=…`). Small and clean.
  Lockheed Martin, Qualcomm, Starbucks, Lam Research, Eaton.
- **Taleo.** Old Oracle product; each tenant has a `/careersection/…` path and a JSON search that differs by tenant. Slowest to generalise.
- Jobvite, ADP, Paycom, Dayforce: each a handful of companies; skip until the above are done.

## 2. Big employers on their own site ("Amazon and co.")

Amazon, Google, Apple, IBM, Tencent and Rheinmetall already have readers. **Apple and IBM were missing from the first
catalogue** because their pages are not auto-detected; both are fixed in it now (Apple reads from a `jobs.apple.com`
link; IBM needs `provider: ibm`). These are the big ones that still have none:

| Employer         | Catalogue status                       | Why it matters                                                      | Notes (believed, unverified) |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------- | ---------------------------- |
| Microsoft        | unsupported (own-site-or-unrecognised) | Software & Cloud                                                    |                              |
| Meta             | unresolved                             | Internet, Social & Consumer Tech, AI & Machine Learning             |                              |
| Walmart          | unsupported (own-site-or-unrecognised) | Retail & E-commerce                                                 |                              |
| Tesla            | unresolved                             | Automotive & EV                                                     |                              |
| Netflix          | unsupported (own-site-or-unrecognised) | Internet, Social & Consumer Tech, Media, Publishing & Entertainment |                              |
| Shopify          | unsupported (own-site-or-unrecognised) | Software & Cloud, Retail & E-commerce                               |                              |
| Booking Holdings | unsupported (own-site-or-unrecognised) | Internet, Social & Consumer Tech, Hospitality, Travel & Leisure     |                              |
| Alibaba          | unsupported (own-site-or-unrecognised) | Internet, Social & Consumer Tech, Retail & E-commerce               |                              |
| ByteDance        | unsupported (own-site-or-unrecognised) | Internet, Social & Consumer Tech                                    |                              |
| Goldman Sachs    | unsupported (own-site-or-unrecognised) | Investment Banking & Asset Management                               |                              |
| HSBC             | unsupported (own-site-or-unrecognised) | Retail & Commercial Banking                                         |                              |
| Wells Fargo      | unsupported (own-site-or-unrecognised) | Retail & Commercial Banking                                         |                              |
| Deloitte         | unsupported (own-site-or-unrecognised) | Accounting, Audit & Tax                                             |                              |
| KPMG             | unsupported (own-site-or-unrecognised) | Accounting, Audit & Tax                                             |                              |
| TCS              | unsupported (own-site-or-unrecognised) | IT Services & Outsourcing                                           |                              |
| Infosys          | unsupported (own-site-or-unrecognised) | IT Services & Outsourcing                                           |                              |
| Cognizant        | unsupported (own-site-or-unrecognised) | IT Services & Outsourcing                                           |                              |
| Volkswagen Group | unsupported (own-site-or-unrecognised) | Automotive & EV                                                     |                              |
| BMW              | unsupported (own-site-or-unrecognised) | Automotive & EV                                                     |                              |
| Siemens          | unsupported (own-site-or-unrecognised) | Industrial Manufacturing                                            |                              |
| General Electric | unsupported (own-site-or-unrecognised) | Industrial Manufacturing                                            |                              |
| Lufthansa Group  | unsupported (own-site-or-unrecognised) | Airlines & Aviation                                                 |                              |
| Emirates Group   | unsupported (own-site-or-unrecognised) | Airlines & Aviation                                                 |                              |
| BBC              | unsupported (own-site-or-unrecognised) | Media, Publishing & Entertainment                                   |                              |
| Deutsche Telekom | unsupported (own-site-or-unrecognised) | Telecoms                                                            |                              |
| Vodafone         | unsupported (own-site-or-unrecognised) | Telecoms                                                            |                              |

Notes on the ones worth a look first:
- **Microsoft**: its careers site is fed by a public JSON search that the page calls; one of the largest feeds on the list, and it also covers Xbox, Activision, King and Microsoft AI/Security entries.
- **Meta**: the careers site talks to a GraphQL endpoint behind anti-bot checks, so this one may not be allowed or stable. Check its terms before building.
- **Goldman Sachs, HSBC, Wells Fargo, Deloitte, KPMG**: each has its own site; Deloitte and KPMG vary by country site. High value for the finance and consulting sectors, but each is a one-company adapter.
- **TCS, Infosys, Cognizant, Tech Mahindra**: the largest IT services employers, each on a bespoke site.
- **Tesla, Walmart**: very large and bot-protected; the catalogue found no confirmed page for Tesla.

A rule of thumb: do a one-company adapter only when the company is both very large and used by many people.
The long tail is better served by the generic boards (Adzuna, LinkedIn, freehire) with the company name in the search.

## 3. Sector boards (like NHS Jobs)

Whole-sector listings that a person switches on, rather than companies:

| Board                                          | Covers                            | State                                                                                                                |
| ---------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| NHS Jobs, jobs.ac.uk                           | health, universities              | done (above)                                                                                                         |
| HigherEdJobs                                   | US universities                   | reader already exists (`higheredjobs`); only needs adding to the catalogue of available boards                       |
| USAJOBS                                        | US federal government, NASA, VA   | Believed to have an official API with a free key; verify.                                                            |
| Teaching Vacancies (gov.uk)                    | England schools                   | Government service; check for a feed.                                                                                |
| Local Government Jobs, council sites           | UK councils                       | Many small sites; probably one aggregator.                                                                           |
| Canada GC Jobs, APSJobs (Australia), EPSO (EU) | national public service           | Only if we serve those countries.                                                                                    |
| Charity Job                                    | UK charities, fundraising, grants | Checked 6 Nov 2026, see below. Easy to read; the open question is permission.                                        |
| ReliefWeb, UN careers (Inspira), Devex         | aid, UN                           | ReliefWeb is restricted (above). Inspira is login-heavy; Devex is paywalled. Check each one's terms before building. |

### Charity Job (charityjob.co.uk)

Checked 6 November 2026. **Technically easy; permission is the open question, so not built yet.**
- **Robots.** `User-agent: *` allows `/jobs…` and disallows only `/feeds/` (which we would not use). It lists AI crawlers
  (GPTBot, ClaudeBot, PerplexityBot and others) with `Crawl-delay: 5` and blocks a few others outright. Winnow is
  one person's own search, not a crawler, but this tells us the site cares about automated readers.
- **Terms.** `/info/legal/termsandconditions` has no clause about scraping or automation. It licenses the _service_
  to account holders and bars exploiting its intellectual property beyond that. That is a grey area, not a yes.
- **How it works.** Search pages are plain HTML, no JavaScript needed: `/jobs?keywords=…&location=…&sort=latest&page=N`.
  Each job is an `<article class="job-card-wrapper" job-id="…">` with the title, "Employer, Place (Hybrid)", pay, a
  summary and "Posted 1 day ago", linking to `/jobs/<employer>/<title>/<id>`. 15 jobs a page; the total is in
  `data-stats="NumberOfTotalResults: 303"`. Promoted ("Top job") cards come first.
- **Rough edges.** Dates are relative ("3 weeks ago"), so the posted date is approximate. The full description is on
  the job's own page, which Winnow already reads when a job is added.
- **Effort.** Small, about the size of NHS Jobs.
- **Recommendation.** Ask CharityJob first (one email: a personal job-search tool reading the public search pages a
  few times a day). If they agree, or you'd rather proceed on robots.txt alone as with NHS Jobs and jobs.ac.uk, read
  the pages slowly (5 seconds between requests, as they ask of crawlers) and say so in the user agent rather than
  posing as a browser.

### Permission checks on the boards already built

| Board              | robots.txt                                                                 | Terms                                               |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------------------- |
| NHS Jobs           | Empty: nothing disallowed.                                                 | No terms-of-use page found, only a privacy policy.  |
| jobs.ac.uk         | Disallows only feedback and a few app paths.                               | Terms say nothing about automated access.           |
| Charity Job        | Allows search pages; disallows `/feeds/`; asks AI crawlers for 5 s delays. | Grey: licence tied to accounts, no scraping clause. |
| ReliefWeb          | Disallows `/*/rss.xml` and paging.                                         | API restricted to approved content partners.        |
| Civil Service Jobs | Allows crawling.                                                           | The site demands a human check on every visit.      |

I read robots.txt for NHS Jobs and jobs.ac.uk before building them but only read their terms afterwards.
Neither forbids automated reading, but both could change, and neither site was asked.

### Civil Service Jobs

`civilservicejobs.service.gov.uk` answers every request with a "Quick check needed" page that asks the visitor to tick
"I'm not a robot" and press Continue (its robots.txt allows crawling, but the page itself is a human check). Winnow
will not click that for a person. Options, in order of preference:
1. **Ask.** The Civil Service Jobs team may supply a feed or an allowed route for a job-search tool.
2. **Go through a board that already carries the roles.** Adzuna and similar aggregators list many civil-service jobs;
   a person can enable one with `what_or` set to departments they care about. Less complete, but allowed.
3. **Job-alert emails** a person forwards in, if Winnow ever reads mail. Heavy.

## 4. Suggested order

1. **Oracle Recruiting** (35 companies, a clean public JSON API). Largest single gain.
2. **Verify the existing readers** (Radancy, SuccessFactors, Avature, CSOD, Phenom) with provider hints on the 40 or so unconfirmed companies. No new code; likely recovers some.
3. **Eightfold**, then **iCIMS**.
4. **USAJOBS** and **HigherEdJobs** as boards, if you serve US users.
5. A one-company adapter for Microsoft, only if people ask for it.
6. **Re-run the catalogue** after each (`scripts/catalogue/README.md`) to see the real gain.
