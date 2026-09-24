# Position type benchmark

This benchmark checks the **Position type filter labels**, which may overlap. For example, a Clinical Assistant Professor should have `Professor`, `Assistant Professor`, and `Clinical Faculty`. Generic `Faculty` is used only when a title supports no more specific type. An empty gold label list means the title does not establish a faculty position type.

## Review set

- `generated/position-type-benchmark-sample.json`: 400 reviewed listings, including 240 randomly sampled jobs and 160 targeted jobs (clinical, research, mixed rank, generic faculty, and stored-label conflicts).
- `generated/position-type-benchmark-holdout.json`: 120 separately reviewed listings, including 80 random jobs and 40 targeted jobs. None overlap the first set.
- `generated/position-type-benchmark-rare.json`: 48 newly reviewed titles, eight each from lecturer, research, visiting, postdoctoral, faculty-role, and faculty-nonrole candidate pools. These listings do not overlap either earlier set. Selection uses title keywords, not predicted labels.
- Labels were assigned from each title. Posting descriptions were consulted for ambiguous examples in the original sets; the fresh 48-title review used titles only. The stored `positionType` was recorded for diagnostics, but was not used as the answer key.
- Rank labels require explicit rank language. A plain “Professor” is not assumed to be a Full Professor. `Clinical Faculty` and `Research Faculty` require evidence of the appointment type, rather than a clinical or research subject area. Postdoctoral research roles are labeled `Postdoctoral`, not `Research Faculty`.

Run `node scripts/benchmark-position-types.js` for the 400-listing set, `node scripts/benchmark-position-types.js --score-holdout` for the 120-listing set, and `node scripts/benchmark-position-types.js --score-rare` for the fresh targeted review. The samples now record source URLs so a listing can be matched after its job ID changes; duplicate URLs are treated as ambiguous and skipped. The scorer also skips listings whose current title no longer matches the reviewed title and reports them under `changed`. It stops rather than writing an empty score when no listings match.

## Results

The first 400-listing review had **89.0% exact match** before the title-rule improvements. The separately reviewed 120-listing set had **95.0% exact match on its first evaluation**. After correcting errors identified in both sets, the scores are **98.8% (395/400)** and **98.3% (118/120)**, respectively. These final scores are diagnostic because the rules were updated after reviewing the disagreements. The initial 95.0% holdout score is the cleaner estimate of performance before holdout-driven fixes.

The original final reports are preserved in `generated/position-type-benchmark-report-legacy.json` and `generated/position-type-benchmark-report-holdout-legacy.json`. Against the current catalog, URL matching recovers **352/400** and **104/120** reviewed listings; after correcting the remaining generic-faculty false positives, the current rules match **352/352** and **104/104** of those surviving listings. These subsets are not random: listings that disappeared or changed title are omitted, and the classifier was developed with the original samples. Their perfect current scores are diagnostic, not independent accuracy estimates.

Two earlier holdout disagreements were a research fellow and a “Faculty Learning Communities” listing that received the generic `Faculty` fallback. They are now excluded from that fallback. A separate fellow category would require its own reviewed definition and examples before adding it to the filter.

The 48-title rare-label review initially scored **89.6% exact match (43/48)**. It exposed missed abbreviations in a research professor and a mixed visiting title, plural visiting lecturers, and two faculty-service titles that were being treated as faculty jobs. After correcting those five cases, the same set scores **100% (48/48)** for filter labels. The new chart-role split was also annotated separately and matches **48/48** reviewed titles. Both final scores are rule-development checks, not independent estimates. The initial and updated reports are saved as `generated/position-type-benchmark-report-rare-initial.json` and `generated/position-type-benchmark-report-rare.json`.

This is a title-focused benchmark, not a verified audit of every posting’s full appointment terms. Rare labels still have small support: the new targeted set contains ten Lecturer, two Research Faculty, eight Visiting Faculty, and nine Postdoctoral gold labels, with no Clinical or Teaching Faculty examples. It is intentionally enriched rather than representative. Do not treat its percentages as population accuracy estimates. For future changes, create another fresh reviewed set before reporting an independent score; reusing these sets for rule changes makes their scores optimistic.
