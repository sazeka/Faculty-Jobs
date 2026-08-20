const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();

export function isSuspiciousSyntheticCareerUrl(value) {
  return /\/faculty\/jobs\/?(?:[?#].*)?$/i.test(clean(value));
}

function duplicatesBy(rows, valueOf) {
  const groups = new Map();
  for (const row of rows) {
    const value = valueOf(row);
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row.name);
  }
  return [...groups.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([value, names]) => ({ value, names: [...new Set(names)].sort() }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function auditInstitutions(rows = []) {
  const institutions = rows.filter((row) => row && clean(row.name));
  const aliases = institutions.flatMap((row) =>
    (Array.isArray(row.aliases) ? row.aliases : []).map((alias) => ({ name: row.name, alias }))
  );
  return {
    institutions: institutions.length,
    duplicateNames: duplicatesBy(institutions, (row) => key(row.name)),
    duplicateUnitids: duplicatesBy(institutions, (row) => clean(row.unitid)),
    aliasCollisions: duplicatesBy(aliases, (row) => key(row.alias)),
    unknownMetadata: institutions
      .filter((row) => !clean(row.state) || !clean(row.control) || !clean(row.level))
      .map((row) => clean(row.name))
      .sort(),
    suspiciousSyntheticCareerUrls: institutions
      .filter((row) => isSuspiciousSyntheticCareerUrl(row.career_url))
      .map((row) => ({ name: row.name, career_url: row.career_url }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function strictAuditFailures(audit = {}) {
  return [
    ["duplicate names", audit.duplicateNames],
    ["duplicate UNITIDs", audit.duplicateUnitids],
    ["alias collisions", audit.aliasCollisions],
    ["unknown metadata", audit.unknownMetadata],
    ["synthetic career URLs", audit.suspiciousSyntheticCareerUrls],
  ]
    .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
    .map(([kind, rows]) => ({ kind, count: rows.length }));
}
