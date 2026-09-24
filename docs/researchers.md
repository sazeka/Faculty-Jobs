# Researcher Access Guide

Faculty Atlas publishes point-in-time metadata about publicly listed faculty jobs at United States higher-education institutions. The release is designed for reproducible research while minimizing republication of third-party text.

## Data access

- Live application snapshot: `public/jobs.json`
- Versioned research releases: `data/releases/YYYY-MM-DD.{json,csv}`
- Release manifest: `data/releases/YYYY-MM-DD.metadata.json`
- Integrity checks: `data/releases/YYYY-MM-DD.sha256`
- Latest-release aliases: `data/releases/latest.*`
- Release index: `data/releases/index.json`

The live application snapshot may contain operational fields and is not the archival contract. Use a dated research release for analysis and citation.

## Scope and unit of observation

- Geography: the 50 United States and Washington, D.C.
- Unit: one publicly listed faculty-job record captured in a snapshot
- Sources: institution-owned career sites and applicant-tracking systems
- Excluded from the research export: full job descriptions and internal collection diagnostics

Coverage is broad but not a census. A missing institution or posting can reflect an unavailable source, technical blocking, a policy exclusion, or no visible opening at collection time.

## Structure

The JSON file contains `schemaVersion`, `scrapedAt`, `count`, and a `jobs` array. The CSV contains the same job records. See:

- `data/data-dictionary.md` for field definitions
- `data/release-schema.json` for the exact publication contract
- `data/schema.json` for the more permissive internal working format

Appointment-track status has four values:

- `tenure-track`
- `non-tenure-track`
- `variable` — the posting explicitly leaves the eventual track open
- `unclassified` — available evidence is insufficient

Only the first two groups should be used as the denominator for binary appointment-track percentages. Keep variable and unclassified counts visible when reporting results.

## Provenance and reproducibility

Each metadata manifest records the snapshot time, source Git commit, schema and methodology versions, complete field list, appointment-track counts, link diagnostics, and SHA-256 hashes for the JSON and CSV files. The `.sha256` file also covers the metadata manifest.

Typical local pipeline:

```bash
npm install
npm run install:browsers
npm run scrape:json
npm run release:dataset
```

To reproduce a cited release, check out the manifest's `sourceCommit`, use the repository dependency lockfile, and run the release command against the corresponding source snapshot.

## Known limitations

- Source availability and anti-bot behavior can change between runs.
- Dates, departments, disciplines, and position types may be absent or normalized from uneven source metadata.
- Appointment-track classification combines explicit posting language, structured fields, title rules, and source-cited institution policies. It is benchmarked but not error-free.
- `firstSeen` is the first Faculty Atlas observation, not necessarily the institution's original posting date.
- Duplicate grouping reduces obvious repetition but should not be treated as a perfect vacancy-level identifier.
- A source URL can later close or redirect even though it was valid at snapshot time.

## Recommended citation

Cite the dataset DOI once published, plus the exact snapshot date, schema version, and access date. Repository citation metadata is in `CITATION.cff`; current data-use terms are in `LICENSE-DATA.md`.
