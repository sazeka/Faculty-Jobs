import { canonicalInstitutionName } from "./institution-aliases.js";
import { normalizeNameKey } from "./url-normalization.js";

function normalizeControl(value) {
  const control = String(value || "").trim().toLowerCase();
  if (control === "public") return "public";
  if (["private", "private nonprofit", "private non-profit"].includes(control)) return "privateNonprofit";
  return null;
}

export function buildInstitutionControlLookup(institutions = []) {
  const lookup = new Map();

  for (const institution of institutions) {
    const control = normalizeControl(institution?.control);
    if (!control) continue;

    const names = [institution?.name, ...(institution?.aliases || [])];
    for (const name of names) {
      const key = normalizeNameKey(canonicalInstitutionName(name));
      if (key) lookup.set(key, control);
    }
  }

  return lookup;
}

export function computeInstitutionControlBreakdown(jobs = [], institutions = []) {
  const lookup = buildInstitutionControlLookup(institutions);
  let publicCount = 0;
  let privateNonprofit = 0;
  let unknown = 0;

  for (const job of jobs) {
    const key = normalizeNameKey(canonicalInstitutionName(job?.college));
    const control = lookup.get(key);
    if (control === "public") publicCount += 1;
    else if (control === "privateNonprofit") privateNonprofit += 1;
    else unknown += 1;
  }

  const classified = publicCount + privateNonprofit;
  return {
    public: publicCount,
    privateNonprofit,
    classified,
    unknown,
    publicPct: classified ? Number(((publicCount / classified) * 100).toFixed(1)) : 0,
    privateNonprofitPct: classified ? Number(((privateNonprofit / classified) * 100).toFixed(1)) : 0,
  };
}
