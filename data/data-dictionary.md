# Data Dictionary

This dictionary describes the publication files created by `npm run release:dataset`. The release is a point-in-time collection of public United States faculty-job metadata. It intentionally excludes full posting descriptions and internal scraper diagnostics.

## Release files

| File | Purpose |
|---|---|
| `YYYY-MM-DD.json` | Structured snapshot with top-level provenance and job records. |
| `YYYY-MM-DD.csv` | The same job records in tabular form. |
| `YYYY-MM-DD.metadata.json` | Scope, provenance, field list, classification counts, diagnostics, and file hashes. |
| `YYYY-MM-DD.sha256` | SHA-256 checksums for the JSON, CSV, and metadata files. |

`latest.*` aliases mirror the most recently generated dated release. `index.json` lists every available release.

## JSON top-level object

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | string | Version of `data/release-schema.json` used by the export. |
| `scrapedAt` | ISO datetime or null | Completion time recorded by the source snapshot. |
| `count` | integer | Number of records in `jobs`. |
| `jobs` | array of objects | Publication-safe job records. |

## Published job fields

| Field | Type | Nullable | Description |
|---|---|---:|---|
| `canonicalJobId` | string | yes | Stable identifier for a source posting when available. |
| `canonicalGroupId` | string | yes | Identifier grouping equivalent or duplicate records when available. |
| `title` | string | no | Position title shown by the source. |
| `url` | URL | no | Direct or best available official source link. |
| `source` | string | no | Faculty Atlas source/system code. |
| `category` | string | yes | Broad role category. |
| `college` | string | yes | Normalized institution name. |
| `location` | string | yes | Location text supplied or normalized from the source. |
| `state` | two-letter string | yes | United States postal abbreviation, taken from a structured field or parsed from `location`. |
| `department` | string | yes | Department or program when recoverable. |
| `specialization` | string | yes | More specific subject area when recoverable. |
| `discipline` | string | yes | Normalized academic discipline. |
| `positionType` | string | yes | Normalized rank or position type. |
| `appointmentTrack` | enum | no | `tenure-track`, `non-tenure-track`, `variable`, or `unclassified`. Variable means the posting explicitly leaves the track open; unclassified means the evidence is insufficient. |
| `appointmentTrackEvidence` | string | yes | Rule/evidence family supporting the classification. Null for unclassified records. |
| `datePosted` | string | yes | Posting date as normalized by the pipeline. |
| `closeDate` | string | yes | Stated closing date when available. |
| `startDate` | string | yes | Stated appointment start date when available. |
| `firstSeen` | string | yes | First date the record appeared in Faculty Atlas. |
| `openUntilFilled` | boolean | yes | Whether the posting explicitly indicates open-until-filled status. |
| `systemGroup` | string | yes | Source-family or higher-education-system grouping. |

Empty CSV cells correspond to JSON `null`. Dates may be absent or reflect source-provided precision; researchers should not infer an exact day where the source did not provide one.

## Working snapshot versus research release

`public/jobs.json` is the live application input and may contain additional operational fields. It is not the archival research contract. The exact publication contract is `data/release-schema.json`; future incompatible changes require a new `schemaVersion`.

The export recomputes appointment-track status using the versioned deterministic classifier at release time. Counts for all four categories are recorded in the metadata manifest.
