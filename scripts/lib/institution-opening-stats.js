function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function key(value) {
  return clean(value).toLowerCase();
}

export function isEligibleInstitution(institution, scope = {}) {
  if (!institution || typeof institution !== "object") return false;

  const level = clean(institution.level).toLowerCase();
  const control = clean(institution.control).toLowerCase();
  const includedLevels = (scope.levelsIncluded || []).map((value) => String(value).toLowerCase());
  const excludedLevels = (scope.excludeLevels || []).map((value) => String(value).toLowerCase());
  const excludedControls = (scope.excludeControls || []).map((value) => String(value).toLowerCase());

  if (includedLevels.length > 0 && level && !includedLevels.includes(level)) return false;
  if (excludedLevels.includes(level)) return false;
  if (excludedControls.includes(control)) return false;
  if (scope.target === "degree-granting" && institution.is_degree_granting === false) return false;
  return true;
}

export function computeInstitutionOpeningStats({
  institutions = [],
  scope = {},
  excludedColleges = [],
} = {}) {
  const excluded = new Set(excludedColleges.map(key));
  const tracked = institutions.filter((institution) =>
    isEligibleInstitution(institution, scope) &&
    !excluded.has(key(institution.name)) &&
    clean(institution.coverage_status).toLowerCase() === "covered"
  );
  const institutionsWithOpenings = tracked.filter(
    (institution) => Number(institution.last_seen_job_count || 0) > 0
  ).length;

  return {
    trackedInstitutions: tracked.length,
    institutionsWithOpenings,
    institutionsWithNoCurrentOpenings: tracked.length - institutionsWithOpenings,
  };
}
