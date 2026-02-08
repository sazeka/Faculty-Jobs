# AI Enrichment (Enrichment-Only Mode)

This adds low-cost AI enrichment to the Faculty-Jobs scraper.
It enriches job postings with summaries, tags, and structured fields
and stores results directly in `jobs.json`.

## Files Added
- `.env.example` — environment variables for AI enrichment
- `.cache/enrichment.json` — auto-created cache (do NOT commit)
- (patched) `server.js` — AI enrichment logic
- (optional patched) `index.html` — prefers `summary` over `description`

## Setup
1. Copy `.env.example` to `.env`
2. Add your OpenAI API key
3. Add `.cache/` to `.gitignore`

## Run
```bash
npm start
# or
node server.js
```

## What Gets Added Per Job
- summary
- fieldTags[]
- roleType
- seniority
- deadline
- workMode
- enrichedAt

Only NEW job URLs are enriched. Cached jobs are reused.
