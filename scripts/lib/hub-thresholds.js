// Shared between generate-hub-pages.js (which builds the pages) and
// generate-job-pages.js (which cross-links to them) so the two never disagree
// about which hub pages actually exist.
export const MIN_STATE_JOBS = 3;
export const MIN_INSTITUTION_JOBS = 2;
export const DISCIPLINE_SKIP = new Set(["Other"]);
