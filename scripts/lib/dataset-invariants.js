/** Return a jobs payload whose count metadata matches its job array. */
export function synchronizeJobCount(payload) {
  if (!payload || !Array.isArray(payload.jobs)) return payload;
  return { ...payload, count: payload.jobs.length };
}
