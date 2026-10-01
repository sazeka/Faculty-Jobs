# Release Validation

Accuracy and coverage evidence for the research-release fields, summarized from the benchmark register (`BENCHMARKING.md`) and its reports in `generated/`. Update this file when a benchmark is rerun; `scripts/package-dataverse.js` embeds it in the Dataverse README.

## Appointment track

Single-reviewer evidence audit of a stratified 200-posting sample (seed 2026-09-23), checked against official posting text and cited institution-policy sources. Report: `generated/appointment-track-review-score-2026-09-23-post-fix.json`.

| Measure | Agreed / reviewed | 95% CI |
|---|---:|---:|
| Tenure-track precision | 59 / 59 | 93.9–100% |
| Non-tenure-track precision | 61 / 61 | 94.1–100% |
| Institution-policy labels | 80 / 80 | 95.4–100% |
| Explicit-language labels | 40 / 40 | 91.2–100% |
| `variable` labels | 20 / 20 | 83.9–100% |
| `unclassified` was a defensible abstention | 60 / 60 | 94.0–100% |

One reviewer scored the sample, and the classifier was revised during the same review cycle, so treat these as upper-leaning estimates. Independent two-coder validation has not been done yet.

External check: among 12 postings matched to the EconJobMarket open-ad feed (2026-09-23) where the feed states the track, all 12 agreed.

## Discipline

On an untouched 100-posting holdout reviewed without seeing classifier output, broad discipline matched the reviewer's label in 78% of cases and subdiscipline in 71%. The taxonomy was then revised using that holdout, so later scores on it are not independent. Details: `ACADEMIC_FIELDS_BENCHMARK.md`.

## Department

`department` is the weakest field. On two reviewed holdouts (n = 59 and n = 53), the department values supplied by the source matched the reviewer's label exactly in 25.4% and 15.1% of postings (22.6% on the second after conservative name normalization). Common problems are a parent school or college given in place of the hiring department, and missing values. Reviewed corrections have been applied to the postings that were labeled, but no automatic extraction is used. Treat `department` as indicative only, and prefer `discipline` for field-level analysis.

## Position type

Position-type rules are checked against hand-labeled title samples, but those samples were used to develop the rules, so no independent population accuracy estimate exists yet. Details: `POSITION_TYPE_BENCHMARK.md`.

## Coverage

The release is not a census. In the EconJobMarket comparison above, Faculty Atlas held 15 of 30 eligible United States academic economics ads (50%), and 15 of 27 (55.6%) at institutions it covers. That is a small, single-discipline sample, but it shows that a substantial share of postings, especially those listed only on discipline job boards, may be missing.
