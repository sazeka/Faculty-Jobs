# Department and academic discipline benchmark

## Field meaning

`department` means the named academic unit responsible for the position: a department, division, school, college, program, institute, or center stated in the posting or its structured fields. A course subject such as “Biology” in a job title is not, by itself, evidence of a Department of Biology. If the source does not name a unit, leave the value empty. `discipline` and `subdiscipline` describe the job's subject and are inferred independently.

When the source names several units, choose the most specific unit explicitly tied to the hiring position. A position's structured Department field can identify a more specific unit than a parent college or center in the title. A specific named title unit wins over an untyped HR code. Ignore professional society memberships, legal boilerplate, contact offices, and other units mentioned only as context. Preserve the source's full name, including donor names and abbreviations, with the evidence quote.

## Regression set

Run `npm run benchmark:academic-fields`. The curated fixture in `data/academic-field-benchmark.json` covers 35 discipline/subdiscipline cases and 10 department cleanup cases. The report is `generated/academic-field-benchmark-report.json`. This is a known-case regression check, not a catalog accuracy estimate.

## Reviewed development sample

`generated/academic-field-review-sample.json` contains 100 deterministic catalog-random listings plus up to 10 listings from each predicted broad discipline, 240 unique listings in all. All 240 have reviewed broad and subdiscipline labels. Source-supported department labels are available for 140; the rest remain unreviewed for Department. The frozen labels are in `data/academic-field-reviewed-labels.json`. These labels were initially seeded from predictions and then reviewed against titles and saved posting text, so the scores should be treated as development results.

Run `node scripts/benchmark-academic-fields.js --reviewed` to score the current catalog and taxonomy. `--source-baseline` measures departments before the 118 source-reviewed corrections; `--candidate-extraction` measures the experimental posting-text extractor without changing jobs. The reports are separate files under `generated/`. The `randomSample` section isolates the 100 catalog-random development rows. The pooled 240-row result is stratified and is not a population estimate.

The reviewed 140-row Department score is 100% after applying the same 140 labels to the catalog. That confirms the reviewed corrections landed; it is not an independent extraction accuracy estimate. The original source values matched 15.7% of these 140 labels. The revised experimental extractor matches 69.3% exactly and 73.6% after conservative name normalization on the same development rows.

## Independent holdout

`generated/academic-field-holdout.json` contains 100 deterministic listings disjoint from the development sample. Their broad and subdiscipline labels were reviewed without seeing classifier predictions. Department labels were frozen for 59 listings with a matching quote from saved posting text; 41 remain unreviewed for Department. Run `node scripts/benchmark-academic-fields.js --score-holdout` for the current catalog, or add `--candidate-extraction` to assess the experimental extractor on the same holdout. Each field is scored only over its reviewed rows.

On the initial untouched holdout, broad discipline accuracy was 78% and subdiscipline exact accuracy was 71%. The holdout exposed additional title patterns and parent-school false positives. After using those disagreements to revise the taxonomy, the same holdout scores 93% broad and 88% subdiscipline. **The revised scores are validation-informed and must not be presented as an independent future accuracy estimate.** A new, separately reviewed holdout is needed before making that claim. Department accuracy on the 59 labeled holdout rows was 25.4% for source values. The latest extractor scores 81.4% exact and 86.4% normalized there; that sample was used for development.

## Fresh Department holdout

`generated/academic-department-holdout-v2.json` contains 100 catalog listings disjoint from both earlier samples. Department labels and verbatim source quotes were frozen for 53 listings before running the revised extractor. The first evaluation, saved in `generated/academic-department-holdout-v2-candidate-report.json`, found 62.3% exact and 66.0% normalized accuracy. The original source values matched 15.1% exactly and 22.6% after normalization. The 33 predictions marked `high` confidence matched 25 exactly and 27 after normalization. These results are the independent estimate for this version; they show that high-confidence automatic fills are not ready.

The 53 reviewed labels were then applied to the catalog where different: 45 corrections, including 14 fills and 31 replacements. The applied changes are recorded in `generated/academic-department-reconciliation-report-v2-applied.json`. Four additional invalid Department values in the earlier reviewed sample were cleared. All 193 reviewed Department rows were synchronized into the site's three chunk sets and listing indexes. A score of corrected catalog rows against their own labels is a correction check, not an extraction estimate. The extractor benchmark always uses the archived pre-review department value when scoring these rows.

## Safe correction workflow

`node scripts/reconcile-academic-departments.js` previews changes from source-reviewed labels. Add `--apply` to apply only those reviewed changes to the three jobs files, preserving the prior value and evidence in each changed record. `--all-evidence` is a dry-run experiment only. `--high-confidence` previews only blank or invalid Department fields with a high-confidence extraction. Applying that mode has an independent gate: at least 20 reviewed high-confidence predictions, at least 90% exact accuracy, and at least 95% normalized accuracy. The fresh holdout fails the gate, so 1,716 proposed fills remain unapplied.

Benchmarks report exact accuracy, precision, recall, and field-level disagreements. Department scores also report conservative normalized accuracy: case, punctuation, `&`/`and`, and a missing organizational word such as `Department` may be treated as equivalent. Two different typed units, such as a School and Department with the same subject, remain different. Normalization changes benchmark comparison only; it never overwrites source names. Inspect disagreements and the confidence breakdown before interpreting a score.
