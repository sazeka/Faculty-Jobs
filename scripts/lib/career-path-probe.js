import { isSuspiciousSyntheticCareerUrl } from "./institution-audit.js";

export function canonicalizeDiscoveredCareerUrl(value) {
  let url = String(value || "").trim();
  if (!url) return url;

  try {
    const parsed = new URL(url);
    if (/safelinks\.protection\.outlook\.com$/i.test(parsed.hostname) && parsed.searchParams.get("url")) {
      url = parsed.searchParams.get("url");
    }
  } catch {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (/schooljobs\.com$/i.test(parsed.hostname)) {
      const match = parsed.pathname.match(/^(\/careers\/[^/]+)(?:\/(?:jobs\/\d+|jobinterestcards)(?:\/.*)?)?$/i);
      if (match) {
        parsed.pathname = match[1];
        parsed.search = "";
      }
    }
    if (/interviewexchange\.com$/i.test(parsed.hostname)) {
      parsed.pathname = parsed.pathname.replace(/;jsessionid=[^/?;]+/gi, "");
    }
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return url;
  }
}

export function isRejectedCareerPage(url, bodyText = "") {
  const value = String(url || "").trim();
  if (isSuspiciousSyntheticCareerUrl(value)) return true;

  try {
    const parsed = new URL(value);
    if (/\/(?:404|404-not-found|not-found)(?:\/|$)/i.test(parsed.pathname)) return true;
    // Student career-readiness, travel, and library-resource pages can contain
    // words such as "faculty" and "employment" without being hiring portals.
    if (/(?:career-readiness|career-exploration|career-services|career-design|career-professional-development|career-transfer-center|career-and-testing-services|career-placement|career-education|career[-_]technical[-_]education|career[-_]and[-_]technical[-_]education|academic[-_]and[-_]career[-_]advising|center-for-career-success|student-employment|current-students\/career|\/students?\/[^?]*career|experiential-learning|faculty-led-travel|academic-career-support|academic-programs|distance-education|library-services|\/news\/)/i.test(parsed.pathname)) return true;
    if (/^\/job\/[^/]+\/?$/i.test(parsed.pathname)) return true;
    if (/^\/faculty\/?$/i.test(parsed.pathname)) return true;
    if (/schooljobs\.com$/i.test(parsed.hostname) && /\/jobs\/\d+/i.test(parsed.pathname)) return true;
    if (/myworkdayjobs\.com$|myworkdaysite\.com$/i.test(parsed.hostname) && /\/job\//i.test(parsed.pathname)) return true;
    if (/csod\.com$/i.test(parsed.hostname) && /\/home\/requisition\/\d+/i.test(parsed.pathname)) return true;
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

export function excludePreviouslyReported(institutions, reportResults) {
  const key = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const skippedNames = new Set((reportResults || []).map((item) => key(item?.name)).filter(Boolean));
  return (institutions || []).filter((item) => !skippedNames.has(key(item?.name)));
}
