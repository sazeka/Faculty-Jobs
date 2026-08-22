import { isSuspiciousSyntheticCareerUrl } from "./institution-audit.js";

export function isRejectedCareerPage(url, bodyText = "") {
  const value = String(url || "").trim();
  if (isSuspiciousSyntheticCareerUrl(value)) return true;

  try {
    const parsed = new URL(value);
    if (/\/(?:404|404-not-found|not-found)(?:\/|$)/i.test(parsed.pathname)) return true;
    // Student career-readiness, travel, and library-resource pages can contain
    // words such as "faculty" and "employment" without being hiring portals.
    if (/(?:career-readiness|career-exploration|career-services|career-design|career-professional-development|career-transfer-center|career-and-testing-services|center-for-career-success|student-employment|current-students\/career|\/students?\/[^?]*career|experiential-learning|faculty-led-travel|academic-career-support|academic-programs|distance-education|library-services|\/news\/)/i.test(parsed.pathname)) return true;
    if (/^\/job\/[^/]+\/?$/i.test(parsed.pathname)) return true;
    if (/^\/faculty\/?$/i.test(parsed.pathname)) return true;
    if (/schooljobs\.com$/i.test(parsed.hostname) && /\/jobs\/\d+/i.test(parsed.pathname)) return true;
    if (/myworkdayjobs\.com$|myworkdaysite\.com$/i.test(parsed.hostname) && /\/job\//i.test(parsed.pathname)) return true;
    if (/recruiting\.paylocity\.com$/i.test(parsed.hostname) && /\/recruiting\/jobs\/details\//i.test(parsed.pathname)) return true;
    if (/insidehighered\.com$/i.test(parsed.hostname) && /\/job\/\d+/i.test(parsed.pathname)) return true;
  } catch {
    return true;
  }

  const title = String(bodyText || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return /(?:\b404\b|page not found|not found|career services)/i.test(title);
}

export function compareDiscoveryPriority(a, b) {
  const attemptsA = Number(a?.discovery_attempts || 0);
  const attemptsB = Number(b?.discovery_attempts || 0);
  if (attemptsA !== attemptsB) return attemptsA - attemptsB;

  const attemptedAtA = String(a?.last_discovery_attempt_at || "");
  const attemptedAtB = String(b?.last_discovery_attempt_at || "");
  if (attemptedAtA !== attemptedAtB) return attemptedAtA.localeCompare(attemptedAtB);
  return String(a?.name || "").localeCompare(String(b?.name || ""));
}
