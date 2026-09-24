# Position type benchmark

This benchmark checks the **Position type filter labels**, which may overlap. For example, a Clinical Assistant Professor should have `Professor`, `Assistant Professor`, and `Clinical Faculty`. Generic `Faculty` is used only when a title supports no more specific type. An empty gold label list means the title does not establish a faculty position type.

## Review set

- `generated/position-type-benchmark-sample.json`: 400 reviewed listings, including 240 randomly sampled jobs and 160 targeted jobs (clinical, research, mixed rank, generic faculty, and stored-label conflicts).
- `generated/position-type-benchmark-holdout.json`: 120 separately reviewed listings, including 80 random jobs and 40 targeted jobs. None overlap the first set.
- Labels were assigned from each title. Posting descriptions were consulted for ambiguous examples. The stored `positionType` was recorded for diagnostics, but was not used as the answer key.
- Rank labels require explicit rank language. A plain “Professor” is not assumed to be a Full Professor. `Clinical Faculty` and `Research Faculty` require evidence of the appointment type, rather than a clinical or research subject area. Postdoctoral research roles are labeled `Postdoctoral`, not `Research Faculty`.

Run `node scripts/benchmark-position-types.js` to score the 400-listing set, and `node scripts/benchmark-position-types.js --score-holdout` to score the separate set. The reports include exact multilabel match, precision and recall for each type, and the individual disagreements. The scorer skips listings whose current title no longer matches the reviewed title and reports them under `changed`.

## Results

The first 400-listing review had **89.0% exact match** before the title-rule improvements. The separately reviewed 120-listing set had **95.0% exact match on its first evaluation**. After correcting errors identified in both sets, the scores are **98.8% (395/400)** and **98.3% (118/120)**, respectively. These final scores are diagnostic because the rules were updated after reviewing the disagreements. The initial 95.0% holdout score is the cleaner estimate of performance before holdout-driven fixes.

The remaining two holdout disagreements are a research fellow and a “Faculty Learning Communities” listing that receive the generic `Faculty` fallback. The latter is a listing-quality issue, and the former needs a distinct fellow category if these jobs should be searchable as a position type.

This is a title-focused benchmark, not a verified audit of every posting’s full appointment terms. Rare labels have small support in the holdout (one Lecturer, three Research Faculty, and four Postdoctoral jobs), so their displayed percentages should not be treated as precise population accuracy estimates. For future changes, create a fresh reviewed set before reporting an independent score; reusing these sets for rule changes makes their scores optimistic.
