# EconJobMarket gap audit — 2026-09-23 snapshot

## Outcome

- Eligible distinct U.S. professor/lecturer ads: **30**
- Matched in the frozen Faculty Atlas snapshot: **15**
- Current snapshot coverage: **50.0%** overall and **55.6%** at represented institutions
- Tenure agreement: **12/12 (100%)**, descriptive because `n < 30`
- Safe source fixes completed for the next scrape: **3 ads**
- Expected next-scrape coverage if those sources remain live: **18/30 (60.0%)**
- Remaining gaps intentionally not imported from EJM: **12**

EconJobMarket remains an external benchmark. Its ads are not copied into Faculty Atlas, because doing so would make future coverage comparisons circular.

## Safe fixes completed

| Institution | Ad | Finding | Fix |
|---|---|---|---|
| Marist University | Assistant Professor of Economics | The official PageUp faculty filter contains the posting, but the source was configured as a generic page. | Changed the source to the official PageUp faculty filter. |
| Cornell University | Assistant Professor in International Trade | AcademicJobsOnline exposed only the generic list title `Assistant Professor`; the field appeared on the detail page. | The adapter now adds a specific keyword/subject field to otherwise generic professorial titles. |
| Cornell University | Associate or Full Professor in Industrial Organization | AcademicJobsOnline exposed only the generic list title `Associate/Full Professor`; the field appeared on the detail page. | Same detail-page title enrichment; live adapter check returned the full benchmark-matchable title. |

## Matcher correction

`University of California, San Diego` was a false gap. Faculty Atlas already had the exact economics listing under the canonical name `University of California-San Diego`. The institution alias is corrected, increasing the frozen-snapshot match count from 14 to 15.

## Remaining source-coverage findings

| Institution | Missing ads | Reason no automatic import was made |
|---|---:|---|
| Brown University | 2 | The active ads use EconJobMarket as the application channel and expose no separate official posting URL. Brown's configured general careers page does not provide an ingestible academic-listing feed. |
| Northwestern University | 5 | Four Kellogg ads point to a separate faculty-recruiting service that redirects anonymous access to Northwestern SSO; the Economics ad has no separate application URL. These do not appear in the configured public PeopleSoft feed. |
| Williams College | 1 | The ad links to official Interfolio posting 190595, but the institution's faculty-positions gateway returned HTTP 403 to automated access during the audit. |
| University of Utah | 1 | The QAMO career-line ad exposes no separate official application URL in the benchmark record and is absent from the current PeopleAdmin snapshot. |
| Massachusetts Institute of Technology | 1 | The Economics ad uses the external board and is absent from MIT's configured PeopleClick results. |
| Stanford University | 1 | The Economics ad uses the external board and is absent from Stanford's official PageUp faculty feed. |
| Washington University in St. Louis | 1 | The ad was posted on 2026-09-22 and is absent from the 2026-09-23 10:08 UTC Workday snapshot; monitor as a latency case before changing the adapter. |

## Interpretation

The current EJM result is primarily a catalog recall and source-latency benchmark, not a tenure-classification failure. Every one of the 12 evaluable matched ads agrees on appointment track. The safe next step is to measure whether the three repaired source records arrive in the next scrape, then recheck the 12 remaining gaps without using EJM itself as a production source.
