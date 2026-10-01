# Department extraction review, 24 September 2026

The experimental extractor is **report only**. Automatic Department fills remain disabled.

| Evaluation set | Reviewed / sampled | Exact | Normalized | High-confidence exact |
| --- | ---: | ---: | ---: | ---: |
| v2 development holdout | 68 / 100 | 46 / 68 (67.6%) | 48 / 68 (70.6%) | 32 / 42 (76.2%) |
| v3 independent holdout | 50 / 80 | 29 / 50 (58.0%) | 31 / 50 (62.0%) | 20 / 32 (62.5%) |

The v3 labels were frozen before the extractor was scored against them. V3 is disjoint from the original review sample, the first holdout, and v2. Unreviewed cases are excluded from the score. A null Department label was assigned only to a complete saved posting that did not name a hiring academic unit. Some saved pages are incomplete or unrelated, so they remain unreviewed.

V3 errors were mostly wrong units (20), with one false positive and no false negatives. Common patterns include a parent college winning over a hiring department, page fields running together, and title or subject phrases mistaken for units. Exact and normalized metrics are both reported; normalized matching is conservative and does not treat a parent school as equivalent to a department.

The reconciliation command applies only source reviewed labels by default. Its optional `--high-confidence --apply` path now requires **both** holdouts independently to have at least 20 reviewed high-confidence predictions, 90% exact accuracy, and 95% normalized accuracy. Both currently fail. The 51 reviewed corrections made in this pass were copied to the three job feeds and their published chunks and search indexes.

Reproduction:

```sh
node scripts/benchmark-academic-fields.js --score-department-holdout-v2 --candidate-extraction
node scripts/benchmark-academic-fields.js --score-department-holdout-v3 --candidate-extraction
node scripts/reconcile-academic-departments.js --high-confidence
```
