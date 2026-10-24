# Stitch reference screens

Generated with Stitch from the "Yinkops Ledger" design system on Oct 23, 2026 (project "Yinkops"). Each folder
has `screen.png` and the exported `code.html` (Tailwind; its colour config uses our token names). They are a
visual guide, not code to reuse.

| Folder             | Screen                                |
| ------------------ | ------------------------------------- |
| `jobs-phone`       | Jobs, Inbox, phone                    |
| `jobs-desktop`     | Jobs, Scored, desktop list and detail |
| `job-detail-phone` | Job detail with score card            |
| `find-phone`       | Find: scans, sources, history         |
| `activity-phone`   | Activity: run cards by state          |

## Where the build departs from them

- The app is called Winnow; Stitch's "Ledger" header is the design system's name.
- Made-up details are left out: CPU, batch numbers, cache sizes, job ref numbers, gateway errors.
- Swipe actions are a plain coloured block with an icon only.
- Filters sit behind one Filters button; only active filters show, as removable chips.
- Find's triage toggle describes triage, not the scan rules.

Worth keeping from them: CV version on the score card and scheduled scans (both in Later).
