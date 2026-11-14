# Company catalogue build

Output: `docs/company-catalogue.json`. Rebuild order (needs network; run from this folder):
1. `node extract.mjs` — parses `docs/popular-companies-by-sector.md` into `companies.json` (stable `id` = slug of the name).
2. download the Greenhouse/Lever/Ashby/Workday directories into `cache/` (see `resolve-directories.ts` header), then
   `node resolve-directories.ts` (add `RECHECK=1` for a low-concurrency retry of misses).
3. `node --experimental-transform-types discover.ts` (`WORKERS=3` is gentler) — finds careers pages for the rest.
4. `node --experimental-transform-types fingerprint.ts`, `extras.ts`, `recheck.ts` — classify and verify.
5. `node merge.mjs` — writes `catalogue.json` (copy to `docs/`). `manual.json` holds hand corrections, `deny.json` wrong directory matches,
   `aliases.json`/`domains.json` brand and careers-URL hints.

A company is `supported` only if Winnow's own provider code loaded real job titles from `careersUrl`.
