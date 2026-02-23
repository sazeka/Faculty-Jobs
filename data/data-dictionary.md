# Data Dictionary

This dictionary describes the structure of `public/jobs.json` and release snapshots generated from it.

## Top-Level Object

| Field | Type | Required | Description |
|---|---|---|---|
| `scrapedAt` | string (ISO datetime) | yes | Timestamp when scraping completed. |
| `count` | integer | yes | Number of jobs in `jobs`. |
| `jobs` | array<object> | yes | Job records. |

## Job Record Fields

| Field | Type | Nullable | Description |
|---|---|---|---|
| `title` | string | no | Job title text from source listing. |
| `url` | string (URL) | no | Canonical source link for the posting. |
| `source` | string | no | Source/system code used by this project (for example `PA`, `UC`, `NY`). |
| `category` | string | yes | High-level role category (for example `Faculty`). |
| `college` | string | yes | Institution name parsed from listing metadata. |
| `location` | string | yes | Location text from source listing. |
| `description` | string | yes | Description snippet or summarized description when available. |
| `department` | string | yes | Department/program when available. |
| `specialization` | string | yes | Discipline specialization when available. |
| `systemGroup` | string | yes | Internal grouping label by source family/system. |

## Notes

- Fields marked nullable may be `null` in JSON and empty in CSV exports.
- CSV releases preserve the same job fields, one row per job.
- For validation details, use `data/schema.json`.

