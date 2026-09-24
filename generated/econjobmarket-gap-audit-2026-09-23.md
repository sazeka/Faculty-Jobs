# EconJobMarket gap audit — 2026-09-23 snapshot

## Outcome

- Eligible distinct U.S. professor/lecturer ads: **30**
- Matched in the frozen Faculty Atlas snapshot: **15**
- Current snapshot coverage: **50.0%** overall and **55.6%** at represented institutions
- Tenure agreement: **12/12 (100%)**, descriptive because `n < 30`
- Safe official-source fixes and live-source arrivals validated for the next scrape: **12 ads**
- Expected next-scrape coverage if those sources remain live: **27/30 (90.0%)** overall and **93.1%** at represented institutions
- Projected tenure agreement: **13/13 (100%)**, still descriptive because `n < 30`
- Remaining gaps intentionally not imported from EJM: **3**

EconJobMarket remains an external benchmark. Its ads are not copied into Faculty Atlas, because doing so would make future coverage comparisons circular.

## Safe fixes completed

| Institution | Ad | Finding | Fix |
|---|---|---|---|
| Marist University | Assistant Professor of Economics | The official PageUp faculty filter contains the posting, but the source was configured as a generic page. | Changed the source to the official PageUp faculty filter. |
| Cornell University | Assistant Professor in International Trade | AcademicJobsOnline exposed only the generic list title `Assistant Professor`; the field appeared on the detail page. | The adapter now adds a specific keyword/subject field to otherwise generic professorial titles. |
| Cornell University | Associate or Full Professor in Industrial Organization | AcademicJobsOnline exposed only the generic list title `Associate/Full Professor`; the field appeared on the detail page. | Same detail-page title enrichment; live adapter check returned the full benchmark-matchable title. |
| Brown University | Assistant, Associate, or Full Professor Rank, Applied Microeconomics | Brown's official Economics page publishes the search heading followed by its application link. | Added a dedicated heading-to-following-link extractor; live validation returned the correct title and application URL. |
| Brown University | Assistant Professor of Economics | Same official department page. | The dedicated extractor returned the second distinct search and its correct application URL. |
| Massachusetts Institute of Technology | Assistant or Untenured Associate Professor – Tenure Track | MIT Economics publishes the exact active search on its official junior-faculty page. | Added the official department page as a supplemental faculty-heading source. |
| Northwestern University | Four Kellogg searches | Kellogg's official recruiting page exposes Strategy, Managerial Economics and Decision Sciences, Finance, and Accounting Information + Management searches. | Added the official Kellogg page and excluded its two navigation-only faculty links. |
| University of Utah | Assistant/Associate/Professor (Lecturer) for the QAMO Division | The posting is live in PeopleAdmin, but Utah's configured query used an obsolete position-type parameter. | Switched to the current official faculty facet (`595[]=2`); live validation returned the exact posting. |

## Live-source arrival

Northwestern's existing central PeopleSoft source now returns **Assistant Professor in Economics** (Job Opening 54198). No new source or benchmark import is needed; the next catalog scrape should pick it up. The same live check also returned the Kellogg managerial-economics search, providing useful overlap between the central and school-level sources.

## Matcher correction

`University of California, San Diego` was a false gap. Faculty Atlas already had the exact economics listing under the canonical name `University of California-San Diego`. The institution alias is corrected, increasing the frozen-snapshot match count from 14 to 15.

## Remaining source-coverage findings

| Institution | Missing ads | Reason no automatic import was made |
|---|---:|---|
| Williams College | 1 | The ad links to official Interfolio posting 190595, but the institution's faculty-positions gateway returned HTTP 403 to automated access during the audit. |
| Stanford University | 1 | The Economics ad uses the external board and is absent from Stanford's official PageUp faculty feed. |
| Washington University in St. Louis | 1 | The ad was posted on 2026-09-22 and is absent from the 2026-09-23 10:08 UTC Workday snapshot; monitor as a latency case before changing the adapter. |

## Interpretation

The current EJM result is primarily a catalog recall and source-latency benchmark, not a tenure-classification failure. Every evaluable matched ad agrees on appointment track. A mixed-language parser issue found during this round was also corrected: MIT describes the overall search as tenure-track while describing one associate-rank salary as "without tenure"; the benchmark now recognizes the independent tenure-track signal instead of treating the first negative phrase as decisive.

The next safe step is a full catalog scrape from the repaired official sources, followed by the same external benchmark. No production records were copied from EconJobMarket to obtain the projected gain.
