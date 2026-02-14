
# Local GPU LLM summarization using Transformers (no OpenAI)
# Optimized for Apple Silicon (MPS) with fallback to CPU
import os, json, time, hashlib, re, html
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

import httpx
from bs4 import BeautifulSoup

# =========================
# Helpers
# =========================

def is_bad_title(title: Optional[str]) -> bool:
    if not title:
        return True
    t = title.strip()
    if len(t) < 6:
        return True
    if re.match(r"^JPF\d+$", t, re.I):
        return True
    return False

RANK_PATTERNS = [
    (re.compile(r"assistant professor", re.I), "Assistant Professor"),
    (re.compile(r"associate professor", re.I), "Associate Professor"),
    (re.compile(r"(full )?professor", re.I), "Professor"),
    (re.compile(r"teaching\s+fellow", re.I), "Teaching Fellow"),
    (re.compile(r"teaching\s+assistant", re.I), "Teaching Assistant"),
    (re.compile(r"research\s+associate", re.I), "Research Associate"),
    (re.compile(r"visiting\s+professor", re.I), "Visiting Professor"),
    (re.compile(r"visiting\s+lecturer", re.I), "Visiting Lecturer"),
    (re.compile(r"adjunct\s+professor", re.I), "Adjunct Professor"),
    (re.compile(r"senior\s+lecturer", re.I), "Senior Lecturer"),
    (re.compile(r"lecturer", re.I), "Lecturer"),
    (re.compile(r"instructor", re.I), "Instructor"),
    (re.compile(r"postdoc|postdoctoral", re.I), "Postdoctoral Scholar"),
]

def guess_rank(text: str) -> Optional[str]:
    for rx, label in RANK_PATTERNS:
        if rx.search(text):
            return label
    return None

def clean_title_jobcode(title: Optional[str]) -> Optional[str]:
    if not title:
        return title
    t = title.strip()
    t = re.sub(r"\(?JPF\d+\)?", "", t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—:,")
    return t or title


def strip_extraneous_title_info(title: Optional[str]) -> Optional[str]:
    """Remove academic year info, dates, and other extraneous details from titles."""
    if not title:
        return title
    t = title.strip()
    # Decode HTML entities (handles &#x20;, &#x27;, &amp;, etc.)
    t = html.unescape(t)
    # Remove "(Anticipated)" and similar parenthetical notes
    t = re.sub(r"\s*\(Anticipated\)", "", t, flags=re.I)
    t = re.sub(r"\s*\(Temporary\)", "", t, flags=re.I)
    t = re.sub(r"\s*\(Part[-\s]?Time\)", "", t, flags=re.I)
    t = re.sub(r"\s*\(Full[-\s]?Time\)", "", t, flags=re.I)
    # Remove academic year patterns like "AY 25-26", "AY2025-2026", "2024-2025"
    t = re.sub(r":?\s*AY\s*'?\d{2,4}[-–]\d{2,4}", "", t, flags=re.I)
    t = re.sub(r":?\s*\d{4}[-–]\d{2,4}", "", t)
    # Remove "Includes Summer 2025" and similar
    t = re.sub(r",?\s*Includes?\s+(Summer|Fall|Spring|Winter)\s+\d{4}", "", t, flags=re.I)
    # Remove semester/year patterns like "Fall 2025", "Spring 2026"
    t = re.sub(r",?\s*(Summer|Fall|Spring|Winter)\s+\d{4}", "", t, flags=re.I)
    # Remove "Pool" suffix (common in lecturer positions)
    t = re.sub(r"\s+Pool\s*$", "", t, flags=re.I)
    # Remove "EOC " prefix (Educational Opportunity Center - organizational prefix, not a dept)
    t = re.sub(r"^EOC\s+", "", t, flags=re.I)
    # Remove "NTTA" (Non-Tenure-Track Appointment) suffix/prefix
    t = re.sub(r"[-\s]+NTTA\b", "", t, flags=re.I)
    t = re.sub(r"\bNTTA[-\s]+", "", t, flags=re.I)
    # Remove SUNY "Region: X Open until filled" suffix
    t = re.sub(r"\s+Region:\s+.*$", "", t, flags=re.I)
    # Remove " - Career Page", " - Job Page", " | Careers" etc. suffixes from page titles
    t = re.sub(r"\s*[-|]\s*Career\s*Page\s*$", "", t, flags=re.I)
    t = re.sub(r"\s*[-|]\s*Job\s*Page\s*$", "", t, flags=re.I)
    # Remove trailing college name after " - " (common in page titles like "Title - University Name")
    t = re.sub(r"\s+-\s+(?:Connecticut State|CT State|University of|College of).*$", "", t, flags=re.I)
    # Remove trailing colons, dashes, commas
    t = re.sub(r"[\s:,\-–—]+$", "", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or title


def extract_department_from_compound_title(title: Optional[str]) -> Optional[str]:
    """Extract department from titles like 'Teaching Assistant in Physics / Natural Sciences'."""
    if not title:
        return None

    # Pattern: "Rank in/of Department" - handle "/" separated departments, take first
    m = re.search(
        r"(?:Teaching\s+(?:Assistant|Fellow)|Lecturer|Instructor|Professor)\s+(?:in|of)\s+([A-Za-z&/,\s\-]+)",
        title, flags=re.I
    )
    if m:
        dept = m.group(1).strip()
        # If there's a "/", take the first part (primary department)
        if "/" in dept:
            dept = dept.split("/")[0].strip()
        # Clean up trailing junk
        dept = re.sub(r"[\s:,\-–—]+$", "", dept).strip()
        if dept and len(dept) > 2:
            return dept

    return None

def infer_department_from_title(title: Optional[str]) -> Optional[str]:
    if not title:
        return None

    # Pattern: "Rank/PC of X" or "Rank/CC of X" (CT State Program Coordinator/Clinical Coordinator)
    # Handles /PC, /CC, /PC/CC, /Program Coordinator, /Clinical Coordinator
    # Must come before "Department Rank" pattern which would incorrectly match "Assistant" as dept
    m = re.search(r"(?:professor|lecturer|instructor)(?:\s*/\s*(?:PC|CC|Program Coordinator|Clinical Coordinator))+\s+(?:of\s+|in\s+)?([A-Za-z&/ ,]{2,60}?)(?:\s+-\s|$)", title, flags=re.I)
    if m:
        return m.group(1).strip()

    # Pattern: "Department Rank" e.g. "Sociology Lecturer Pool"
    m = re.match(
        r"^([A-Za-z&/ ,\-]{2,60})\s+(Lecturer|Assistant Professor|Associate Professor|Professor|Instructor)(?:\s+Pool)?",
        title,
        flags=re.I,
    )
    if m:
        return m.group(1).strip()

    # Pattern: "Rank of/in Department"
    m = re.search(r"(?:professor|lecturer|instructor)\s+(?:of|in)\s+([A-Za-z&/ ,\-]{2,60})", title, flags=re.I)
    if m:
        return m.group(1).strip()

    # Pattern: "Department of X"
    m = re.search(r"Department\s+of\s+([A-Za-z&/ ,\-]{2,60})", title, flags=re.I)
    if m:
        return m.group(1).strip()

    # Pattern: "X Department"
    m = re.search(r"([A-Za-z&/ ]{2,40})\s+Department", title, flags=re.I)
    if m:
        return m.group(1).strip()

    # Pattern: just "of X" anywhere
    m = re.search(r"\bof\s+([A-Za-z&/ ,\-]{2,60})(?:\s|$)", title, flags=re.I)
    if m:
        dept = m.group(1).strip()
        # Filter out common non-department phrases
        if dept.lower() not in ["the", "a", "an", "employment", "california"]:
            return dept

    return None


def extract_specialization(title: Optional[str], page_text: Optional[str]) -> Optional[str]:
    """
    Extract the specific position/specialization from title or page text.
    E.g., "Mathematics Education" from "Assistant Professor of Mathematics Education"
    This captures more specific info than just the department.
    """
    if not title and not page_text:
        return None

    # Clean up title for processing
    t = title or ""

    # Pattern 1: "Rank of/in [Specific Field]" - capture the full field name
    # E.g., "Assistant Professor of Mathematics Education" -> "Mathematics Education"
    m = re.search(
        r"(?:Professor|Lecturer|Instructor|Fellow)\s+(?:of|in)\s+([A-Za-z&/,\s\-]{3,80}?)(?:\s*[-–]|\s*\(|\s*,\s*(?:Department|School|College)|$)",
        t, flags=re.I
    )
    if m:
        spec = m.group(1).strip()
        spec = re.sub(r"[\s,\-–]+$", "", spec).strip()
        rank_words = ["professor", "assistant", "associate", "lecturer", "instructor", "scholar", "dean", "chair"]
        if spec and len(spec) > 3 and not any(w in spec.lower() for w in rank_words):
            return spec

    # Pattern 2: "[Specific Field] Rank" before the rank
    # E.g., "Mathematics Education Lecturer" -> "Mathematics Education"
    m = re.match(
        r"^([A-Za-z&/,\s\-]{3,80}?)\s+(?:Lecturer|Assistant\s+Professor|Associate\s+Professor|Professor|Instructor|Fellow)(?:\s+Pool)?",
        t, flags=re.I
    )
    if m:
        spec = m.group(1).strip()
        spec = re.sub(r"[\s,\-–]+$", "", spec).strip()
        # Filter out generic terms and rank-related words that aren't specializations
        generic = ["tenure", "track", "visiting", "adjunct", "senior", "junior", "full", "part", "time"]
        rank_words = ["professor", "assistant", "associate", "lecturer", "instructor", "scholar", "dean", "chair"]
        spec_lower = spec.lower()
        if spec and len(spec) > 3 and spec_lower not in generic and not any(w in spec_lower for w in rank_words):
            return spec

    # Pattern 3: Look in page text for "position in X" or "specializing in X"
    # But be careful to avoid boilerplate text
    if page_text:
        # Blacklist of boilerplate phrases that should not be extracted
        boilerplate = [
            "context of the home",
            "the context of",
            "home department",
            "this position",
            "the department",
            "our department",
            "the school",
            "the college",
            "the university",
            "the faculty",
        ]

        for pattern in [
            r"position\s+in\s+([A-Za-z&/,\s\-]{3,60}?)(?:\.|,|\s+with|\s+at|\s+and|\s+in\s+the)",
            r"specializ(?:ing|ation)\s+in\s+([A-Za-z&/,\s\-]{3,60}?)(?:\.|,|\s+with|\s+at|\s+and)",
            r"expertise\s+in\s+([A-Za-z&/,\s\-]{3,60}?)(?:\.|,|\s+with|\s+at|\s+and)",
            r"field\s+of\s+([A-Za-z&/,\s\-]{3,60}?)(?:\.|,|\s+with|\s+at|\s+and)",
        ]:
            m = re.search(pattern, page_text, flags=re.I)
            if m:
                spec = m.group(1).strip()
                spec = re.sub(r"[\s,\-–]+$", "", spec).strip()
                # Skip if it matches boilerplate text
                spec_lower = spec.lower()
                if any(bp in spec_lower for bp in boilerplate):
                    continue
                if spec and len(spec) > 3:
                    return spec

    return None

def extract_department_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    for label in ["Discipline", "Department", "Program", "School"]:
        m = re.search(rf"{label}\s*:\s*([A-Za-z&/ ,\-]{{2,80}})", text, flags=re.I)
        if m:
            val = m.group(1).strip()
            # Reject nav-text contamination (page numbers, Search #, etc.)
            if re.search(r"Search\s*#|^\d+$|^page\s+\d", val, re.I):
                continue
            return val
    return None


# =========================
# Track + deadline extraction
# =========================

TENURE_TRUE = [
    re.compile(r"\btenure[-\s]?track\b", re.I),
    re.compile(r"\btenure[-\s]?eligible\b", re.I),
    re.compile(r"\btenure[-\s]?line\b", re.I),
    re.compile(r"\btenured\s+or\s+tenure[-\s]?track\b", re.I),
]
TENURE_FALSE = [
    re.compile(r"\bnon[-\s]?tenure\b", re.I),
    re.compile(r"\bwithout\s+tenure\b", re.I),
    re.compile(r"\bsecurity\s+of\s+employment\b", re.I),  # often used for continuing appointments; weak
]

OPEN_UNTIL_FILLED = [
    re.compile(r"\bopen\s+until\s+filled\b", re.I),
    re.compile(r"\buntil\s+filled\b", re.I),
    re.compile(r"\bposition\s+open\s+until\s+filled\b", re.I),
]

def detect_tenure_track(text: str) -> Optional[bool]:
    if not text:
        return None
    for rx in TENURE_TRUE:
        if rx.search(text):
            return True
    for rx in TENURE_FALSE:
        if rx.search(text):
            return False
    return None

MONTHS = r"(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)"
DATE_PATTERNS = [
    # Month Day, Year
    re.compile(rf"\b{MONTHS}\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,)?\s+(\d{{4}})\b", re.I),
    # MM/DD/YYYY or M/D/YYYY
    re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b"),
]

def _month_to_int(m: str) -> int:
    m = m.strip().lower().replace(".", "")
    lookup = {
        "january": 1, "jan": 1,
        "february": 2, "feb": 2,
        "march": 3, "mar": 3,
        "april": 4, "apr": 4,
        "may": 5,
        "june": 6, "jun": 6,
        "july": 7, "jul": 7,
        "august": 8, "aug": 8,
        "september": 9, "sep": 9, "sept": 9,
        "october": 10, "oct": 10,
        "november": 11, "nov": 11,
        "december": 12, "dec": 12,
    }
    return lookup.get(m, 0)

def parse_date_to_iso(raw: str) -> Optional[str]:
    # Try supported patterns and return YYYY-MM-DD
    if not raw:
        return None
    raw = raw.strip()
    m = DATE_PATTERNS[0].search(raw)
    if m:
        month = _month_to_int(m.group(1))
        day = int(m.group(2))
        year = int(m.group(3))
        if month:
            return f"{year:04d}-{month:02d}-{day:02d}"
    m = DATE_PATTERNS[1].search(raw)
    if m:
        month = int(m.group(1))
        day = int(m.group(2))
        year = int(m.group(3))
        return f"{year:04d}-{month:02d}-{day:02d}"
    return None

DEADLINE_LABELS = [
    ("closeDate_final", re.compile(r"\b(final\s+date|closing\s+date|application\s+deadline|apply\s+by)\b", re.I)),
    ("closeDate_initial_review", re.compile(r"\b(initial\s+review\s+date|full\s+consideration)\b", re.I)),
    ("closeDate_next_review", re.compile(r"\b(next\s+review\s+date)\b", re.I)),
]

def extract_close_date(text: str) -> dict:
    """
    Returns:
      {
        closeDate: ISO YYYY-MM-DD or None,
        closeDateType: one of closeDate_final / closeDate_initial_review / closeDate_next_review / None,
        closeDateRaw: raw snippet,
        openUntilFilled: bool
      }
    """
    out = {"closeDate": None, "closeDateType": None, "closeDateRaw": None, "openUntilFilled": False}
    if not text:
        return out

    if any(rx.search(text) for rx in OPEN_UNTIL_FILLED):
        out["openUntilFilled"] = True

    # Search for labeled dates by scanning around label occurrences
    for dtype, label_rx in DEADLINE_LABELS:
        for lm in label_rx.finditer(text):
            window = text[lm.start(): lm.start() + 220]  # lookahead window
            # Find the first date in this window
            raw_date = None
            for rx in DATE_PATTERNS:
                dm = rx.search(window)
                if dm:
                    raw_date = dm.group(0)
                    break
            if raw_date:
                iso = parse_date_to_iso(raw_date)
                if iso:
                    out["closeDate"] = iso
                    out["closeDateType"] = dtype
                    out["closeDateRaw"] = raw_date
                    return out  # prefer first strong hit

    # Fallback: first date anywhere in text (weak)
    for rx in DATE_PATTERNS:
        dm = rx.search(text)
        if dm:
            raw_date = dm.group(0)
            iso = parse_date_to_iso(raw_date)
            if iso:
                out["closeDate"] = iso
                out["closeDateType"] = "closeDate_unlabeled"
                out["closeDateRaw"] = raw_date
                break
    return out

def extract_uc_recruit_title_dept(html: str):
    if not html:
        return None, None

    title = None
    m = re.search(r'property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']', html, re.I)
    if m:
        title = m.group(1).strip()

    if not title or is_bad_title(title):
        m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
        if m:
            t = re.sub(r"<[^>]+>", "", m.group(1)).strip()
            if not is_bad_title(t):
                title = t

    if not title or is_bad_title(title):
        m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
        if m:
            t = re.sub(r"<[^>]+>", "", m.group(1))
            t = re.sub(r"\s*\|\s*UC Recruit.*$", "", t).strip()
            if not is_bad_title(t):
                title = t

    dept = None
    # Try multiple patterns to extract department
    dept_patterns = [
        r"Department:\s*</[^>]+>\s*([^<]{2,80})<",
        r"Discipline:\s*</[^>]+>\s*([^<]{2,80})<",
        r"Department\s*</th>\s*<td[^>]*>\s*([^<]{2,80})<",
        r"Discipline\s*</th>\s*<td[^>]*>\s*([^<]{2,80})<",
        r'"department"[^>]*>\s*([^<]{2,80})<',
        r'Department[:\s]+([A-Za-z&/,\s\-]{2,80})(?:<|$)',
        r'>Department<[^>]*>[^<]*<[^>]*>([^<]{2,80})<',
    ]
    for rx in dept_patterns:
        m = re.search(rx, html, re.I)
        if m:
            d = m.group(1).strip()
            # Filter out junk
            if d and len(d) > 2 and not d.startswith("http"):
                dept = d
                break

    return clean_title_jobcode(title), dept


def clean_field_name(field: Optional[str]) -> Optional[str]:
    """Remove rank-related words and junk from department/specialization names."""
    if not field:
        return None

    f = field.strip()

    # Patterns to fully reject (field is just these words or rank combinations)
    reject_patterns = [
        r"^Assistant\s+or\s+Associate$",
        r"^Assistant,?\s+Associate,?\s+(or\s+)?Full$",
        r"^Assistant/Associate(/Full)?$",
        r"^(Assistant|Associate|Full)\s+Professor/(Assistant|Associate|Full).*$",
        r"^Associate\s+(or\s+)?Full$",
        r"^Assistant/Associate/?\s*/?\s*Full$",
        r"^Assistant/Associate\s+Tenure\s+Track$",
        r"^Assistant$",
        r"^Associate$",
        r"^Professor$",
        r"^Lecturer$",
        r"^Instructor$",
        r"^Full$",
        r"^Clinical$",
        r"^Clinical\s+Assistant$",
        r"^Eoc$",
        r"^Ntta$",
        r".*Ntta$",
        r"^Medical\s+Director.*$",
        r"^Program\s+Director.*$",
        r"^Tenure\s+Track.*$",
        r"^Open\s+Rank.*$",
        r".*Search\s*#.*",
        r"^Search$",
    ]

    for pattern in reject_patterns:
        if re.match(pattern, f, re.I):
            return None

    # Prefixes to strip
    prefix_patterns = [
        r"^the\s+Department\s+of\s+",
        r"^Department\s+of\s+",
        r"^the\s+",
    ]

    for pattern in prefix_patterns:
        f = re.sub(pattern, "", f, flags=re.I)

    # Remove location suffixes (NYC boroughs, etc.)
    f = re.sub(r'\s*(New\s*York|Brooklyn|Staten\s*Island|Bronx|Queens|Manhattan|NY|CUNY|SUNY|HUNTER|BARUCH|COLLEGE|NYCITY).*$', '', f, flags=re.I)

    # Remove rank-related suffixes like " - Associate" or ", Assistant"
    f = re.sub(r'\s*[-,]\s*(Assistant|Associate|Professor|Lecturer|Instructor)\s*$', '', f, flags=re.I)

    # Remove "Tenure Track" suffix
    f = re.sub(r'\s+Tenure\s+Track\s+(Assistant|Associate|Full)?\s*$', '', f, flags=re.I)

    # Remove "Region" suffix (SUNY titles include "Region: X")
    f = re.sub(r'\s+Region\b.*$', '', f, flags=re.I)

    # Strip trailing punctuation
    f = f.strip().rstrip('.,;:')
    f = f.strip()

    # Reject if too short or still contains only rank words
    if len(f) < 3:
        return None

    # Reject location-only values (city names without context)
    location_only = ["syracuse", "buffalo", "albany", "binghamton", "stony brook",
                     "new york", "brooklyn", "manhattan", "queens", "bronx"]
    if f.lower() in location_only:
        return None

    rank_words = ["assistant", "associate", "professor", "lecturer", "instructor", "doctoral", "full"]
    if f.lower() in rank_words:
        return None

    # Reject boilerplate words/phrases that are not real departments
    boilerplate_exact = ["chair", "of the", "in the", "error", "cnse", "cehc",
                         "admissions", "alumni", "syracuse", "extended learning",
                         "job opportunities", "employment opportunities", "careers"]
    boilerplate_contains = ["context", "home department", "the department",
                            "this position", "our department", "the school",
                            "the college", "the university", ".img-responsive",
                            "width:", "max-width:", "padding:", "margin:",
                            "{", "}", "inner", "outer", "residence life",
                            "facilities", "it &", "housing", "dining",
                            "parking", "athletics", "recreation",
                            "javascript", "careers at", "job opportunities",
                            "employment opportunities", "header-inner",
                            "alumni relations", "budget director", "curriculum development",
                            "print and mail", "clinic suite", "vpsl",
                            "environmental services", "linen", "ntp-",
                            "rf - step", "region:", "open until filled",
                            "wf2", "(wf", "search #"]
    boilerplate_startswith = ["of ", "in ", "the ", "and ", "or ", ".", "it ", "at "]
    f_lower = f.lower()
    if f_lower in boilerplate_exact:
        return None
    if any(bp in f_lower for bp in boilerplate_contains):
        return None
    if any(f_lower.startswith(bp) for bp in boilerplate_startswith):
        return None

    # Reject if it's mostly rank words (e.g., "Associate Professor or Full")
    words = f.lower().split()
    rank_word_count = sum(1 for w in words if w in rank_words or w in ['or', 'and', ','])
    if len(words) > 0 and rank_word_count / len(words) > 0.5:
        return None

    return f


def extract_field_from_title(original_title: Optional[str]) -> Optional[str]:
    """
    Try to extract specialization/department from original title.
    Handles formats like:
    - "Assistant Professor - Human Resources"
    - "Professor of Chemistry"
    - "Lecturer in Mathematics"
    """
    if not original_title:
        return None

    # Normalize dashes (en-dash, em-dash) to hyphen
    title = original_title.replace('–', '-').replace('—', '-')

    # Try to find field after separator (hyphen with optional spaces)
    # Matches: " - ", "- ", " -", "-"
    match = re.search(r'\s*-\s*(.+?)(?:\s*New\s*York|Brooklyn|Staten|Bronx|Queens|$)', title, re.I)
    if match:
        field = clean_field_name(match.group(1).strip())
        if field:
            return field

    # Try "of X" or "in X" pattern
    match = re.search(r'\b(?:of|in)\s+(.+?)(?:\s*[-,]|New\s*York|Brooklyn|$)', title, re.I)
    if match:
        field = clean_field_name(match.group(1).strip())
        if field:
            return field

    # Try comma-separated: "Rank, Field" (e.g., "Assistant Professor, Cellular Neuroscience")
    match = re.match(
        r'^(?:(?:Assistant|Associate|Full|Clinical|Visiting|Adjunct|Research|Senior)\s+)?'
        r'(?:Professor|Lecturer|Instructor|Fellow),\s*(.+?)$',
        title, re.I
    )
    if match:
        field = clean_field_name(match.group(1).strip())
        if field:
            return field

    return None


def to_title_case(text: str) -> str:
    """
    Convert text to proper title case, preserving acronyms and handling special cases.
    """
    if not text:
        return text

    # Words that should stay lowercase (unless first word)
    lowercase_words = {'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at',
                       'to', 'by', 'of', 'in', 'with', 'as', 'is', 'vs'}

    # Words/acronyms that should stay uppercase
    uppercase_words = {'PhD', 'Ph.D.', 'MBA', 'MD', 'JD', 'EdD', 'DNP', 'RN', 'MSW',
                       'STEM', 'ESL', 'ELL', 'IT', 'AI', 'HR', 'NY', 'NYC', 'US', 'USA',
                       'II', 'III', 'IV', 'CUNY', 'SUNY', 'CSU', 'UC'}

    words = text.split()
    result = []

    for i, word in enumerate(words):
        # Check if it's an acronym we should preserve
        word_upper = word.upper().rstrip('.,;:')
        if word_upper in uppercase_words or word.upper() in uppercase_words:
            result.append(word.upper() if word.isupper() else word)
        # Check if word is already properly cased (like "PhD" or a name)
        elif word[0].isupper() and not word.isupper():
            result.append(word)
        # First word or after punctuation - always capitalize
        elif i == 0 or (result and result[-1].endswith((':','-'))):
            result.append(word.capitalize())
        # Lowercase words
        elif word.lower() in lowercase_words:
            result.append(word.lower())
        # Regular words - capitalize
        else:
            result.append(word.capitalize())

    return ' '.join(result)


def is_valid_title(title: Optional[str]) -> bool:
    """Check if a title is valid (not junk/boilerplate)."""
    if not title:
        return False
    t = title.lower()
    bad_patterns = [
        "careers at", "job opportunities", "employment opportunities",
        "javascript", ".img-responsive", "header-inner", "{", "}",
        "width:", "padding:", "region:", "open until filled",
        "page not found", "error", "404"
    ]
    return not any(bp in t for bp in bad_patterns)


def _decode_html_entities(text: str) -> str:
    """Decode HTML entities in text (handles all numeric/named entities)."""
    if not text:
        return text
    return html.unescape(text)


def make_concise_title(rank: Optional[str], dept: Optional[str], specialization: Optional[str], original_title: Optional[str]) -> str:
    """
    Create a concise title in format: Rank - Specialization
    Falls back to: Rank - Department, then just Rank, then original title.

    Specialization is more specific (e.g., "Mathematics Education")
    Department is broader (e.g., "Education")
    """
    # Clean the field names to remove rank-related junk
    clean_spec = clean_field_name(specialization)
    clean_dept = clean_field_name(dept)

    # Prefer specialization over department since it's more specific
    field = clean_spec or clean_dept

    # Fallback: try to extract from original title if LLM gave bad values
    if not field:
        field = extract_field_from_title(original_title)

    # Apply proper title case to the field
    if field:
        field = to_title_case(field)

    # If rank is missing, try to infer it from the original title
    if not rank and original_title:
        rank = guess_rank(original_title)

    # Build the title
    if rank and field:
        result = f"{rank} - {field}"
    elif rank:
        result = rank
    elif field:
        result = field
    elif original_title and is_valid_title(original_title):
        result = original_title
    else:
        return "(No title)"

    # Final validation - if result looks like junk, fall back to original or rank
    if not is_valid_title(result):
        if rank and original_title and is_valid_title(original_title):
            # Try to extract field from original title
            extracted = extract_field_from_title(original_title)
            if extracted:
                return _decode_html_entities(f"{rank} - {to_title_case(extracted)}")
            return rank
        elif rank:
            return rank
        elif original_title and is_valid_title(original_title):
            return _decode_html_entities(original_title)
        return "(No title)"

    return _decode_html_entities(result)

# =========================
# Fetch helpers with rate limiting
# =========================

from urllib.parse import urlparse
import threading

# Domain-based rate limiting to avoid 429 errors
_domain_last_request: dict = {}
_domain_lock = threading.Lock()

# Domains that need aggressive rate limiting (in seconds between requests)
# Domains that need aggressive rate limiting (in seconds between requests)
# Note: interviewexchange.com shares rate limits across all subdomains
RATE_LIMIT_DOMAINS = {
    "interviewexchange.com": 10.0,  # 10 seconds - they're very strict
    "default": 0.5,  # 0.5 seconds for other domains
}

# Domains where we should normalize subdomains to parent domain for rate limiting
# e.g., binghamton.interviewexchange.com -> interviewexchange.com
SHARED_RATE_LIMIT_DOMAINS = ["interviewexchange.com"]

# Domains to skip fetching entirely - too aggressive with rate limiting
# We'll extract info from the title instead
SKIP_FETCH_DOMAINS = ["interviewexchange.com", "jobs.liu.edu", "cortland.edu"]

def should_skip_fetch(url: str) -> bool:
    """Check if we should skip fetching this URL due to rate limiting or JS-only content."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        # Skip domains known to have issues
        for skip_domain in SKIP_FETCH_DOMAINS:
            if skip_domain in domain:
                return True

        # Skip hash-based URLs (require JavaScript to load content)
        if parsed.fragment and ('job' in parsed.fragment.lower() or 'detail' in parsed.fragment.lower()):
            return True

    except:
        pass
    return False

def normalize_domain_for_rate_limit(domain: str) -> str:
    """Normalize domain for rate limiting - some sites share limits across subdomains."""
    for shared in SHARED_RATE_LIMIT_DOMAINS:
        if shared in domain:
            return shared
    return domain

def get_rate_limit_delay(domain: str) -> float:
    """Get the rate limit delay for a domain."""
    normalized = normalize_domain_for_rate_limit(domain)
    for key, delay in RATE_LIMIT_DOMAINS.items():
        if key in normalized:
            return delay
    return RATE_LIMIT_DOMAINS["default"]

def wait_for_rate_limit(url: str):
    """Wait if needed to respect rate limits for the domain."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
    except:
        return

    # Normalize domain for shared rate limiting
    rate_limit_key = normalize_domain_for_rate_limit(domain)
    delay = get_rate_limit_delay(domain)

    with _domain_lock:
        now = time.time()
        last = _domain_last_request.get(rate_limit_key, 0)
        wait_time = delay - (now - last)
        if wait_time > 0:
            time.sleep(wait_time)
        _domain_last_request[rate_limit_key] = time.time()

def fetch_job_page_html(url: str, timeout: float = 20.0, max_retries: int = 3) -> Optional[str]:
    # Apply rate limiting before fetching
    wait_for_rate_limit(url)

    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=timeout, follow_redirects=True) as client:
                r = client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                })

                # Handle rate limiting (429)
                if r.status_code == 429:
                    retry_after = int(r.headers.get("Retry-After", 5))
                    wait_time = min(retry_after, 30) * (attempt + 1)
                    print(f"[WARN] Rate limited (429) for {url}, waiting {wait_time}s (attempt {attempt + 1}/{max_retries})")
                    time.sleep(wait_time)
                    continue

                r.raise_for_status()
                return r.text
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                wait_time = 5 * (attempt + 1)
                print(f"[WARN] Rate limited for {url}, waiting {wait_time}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait_time)
                continue
            print(f"[WARN] fetch failed {url}: {e}")
            return None
        except Exception as e:
            print(f"[WARN] fetch failed {url}: {e}")
            return None

    print(f"[WARN] fetch failed after {max_retries} retries: {url}")
    return None

def extract_visible_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True))

# =========================
# FastAPI + model
# =========================

HF_MODEL = os.environ.get("HF_MODEL", "Qwen/Qwen2.5-7B-Instruct")
PORT = int(os.environ.get("SUMMARIZER_PORT", "9000"))
CACHE_PATH = os.path.join(".cache", "summaries.json")

# When imported by ray_summarizer, skip heavy init (model loading, cache, FastAPI).
# Ray Serve handles all of that in its own deployment class.
_STANDALONE = not os.environ.get("SUMMARIZER_RAY_MODE")

if _STANDALONE:
    os.makedirs(".cache", exist_ok=True)
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            CACHE = json.load(f)
    except Exception:
        CACHE = {}

app = FastAPI() if _STANDALONE else None

class Job(BaseModel):
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    college: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None

class SummarizeRequest(BaseModel):
    jobs: List[Job]
    max_new_tokens: Optional[int] = 220

def key_for(job: Job) -> str:
    payload = (job.url + "|" + (job.title or "") + "|" + (job.description or "")[:2000]).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

# Detect best available device
def get_device():
    if torch.backends.mps.is_available():
        return "mps"  # Apple Silicon GPU
    elif torch.cuda.is_available():
        return "cuda"
    return "cpu"

if _STANDALONE:
    DEVICE = get_device()

    tokenizer = AutoTokenizer.from_pretrained(HF_MODEL, use_fast=True)
    tokenizer.pad_token = tokenizer.eos_token

    # Load model optimized for available hardware
    if DEVICE == "mps":
        print(f"[INFO] Loading {HF_MODEL} on Apple Silicon (MPS) with float16")
        model = AutoModelForCausalLM.from_pretrained(
            HF_MODEL,
            dtype=torch.float16,
            low_cpu_mem_usage=True,
        ).to("mps")
    elif DEVICE == "cuda":
        print(f"[INFO] Loading {HF_MODEL} on GPU: {torch.cuda.get_device_name(0)}")
        model = AutoModelForCausalLM.from_pretrained(
            HF_MODEL,
            dtype=torch.float16,
            device_map="auto",
        )
    else:
        print(f"[WARN] No GPU detected, loading {HF_MODEL} on CPU (will be slower)")
        model = AutoModelForCausalLM.from_pretrained(HF_MODEL)

    model.config.pad_token_id = tokenizer.eos_token_id

# =========================
# Text Cleaning
# =========================

def clean_page_text_for_llm(text: str) -> str:
    """Remove application form noise, navigation, and other junk from page text."""
    if not text:
        return ""

    # Remove common form field patterns
    patterns_to_remove = [
        r"Do you have a valid[^.?]*\??\s*(Yes|No)?",
        r"Please (indicate|provide|select|enter|specify)[^.]*\.",
        r"If (yes|no),?\s*please[^.]*\.",
        r"\* Required",
        r"Are you (currently|willing|authorized|a citizen)[^.?]*\??",
        r"How did you (hear|learn) about[^.?]*\??",
        r"Upload (your )?(resume|CV|cover letter|document)[^.]*",
        r"Drag and drop[^.]*",
        r"Browse files?",
        r"Maximum file size[^.]*",
        r"Accepted file types[^.]*",
        r"(LinkedIn|Indeed|Facebook|Twitter|Instagram|Google)[^.]*",
        r"Career\s*(Services|Site|Portal)[^.]*",
        r"Employee Referral[^.]*",
        r"Word of Mouth[^.]*",
        r"Other Social Media[^.]*",
        r"Sign in|Log in|Create account|Apply now|Submit application",
        r"Cookie\s*(policy|preferences|settings)[^.]*",
        r"Privacy\s*(policy|statement|notice)[^.]*",
    ]

    cleaned = text
    for pattern in patterns_to_remove:
        cleaned = re.sub(pattern, " ", cleaned, flags=re.I)

    # Remove repeated words (like "Networked Academics Networked Academics...")
    cleaned = re.sub(r'\b(\w+(?:\s+\w+)?)\s+(?:\1\s*){3,}', r'\1 ', cleaned)

    # Collapse multiple spaces
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()

    return cleaned


def validate_summary(summary: str) -> tuple[bool, Optional[str]]:
    """Check if summary is valid. Returns (is_valid, reason_if_invalid)."""
    if not summary or len(summary.strip()) < 20:
        return False, "too_short"

    s = summary.strip()

    # Check for prompt leakage
    if "Human:" in s or "Assistant:" in s:
        return False, "prompt_leakage"

    # Check for meta-commentary
    meta_patterns = [
        r"\(Note:",
        r"\(Word count:",
        r"This summary",
        r"The summary has been",
        r"Please let me know",
        r"Can you provide",
        r"I hope this helps",
    ]
    for pattern in meta_patterns:
        if re.search(pattern, s, re.I):
            return False, "meta_commentary"

    # Check for excessive repetition
    words = s.split()
    if len(words) > 10:
        word_counts = {}
        for w in words:
            w_lower = w.lower()
            word_counts[w_lower] = word_counts.get(w_lower, 0) + 1
        max_count = max(word_counts.values())
        if max_count > len(words) * 0.3:  # Same word > 30% of text
            return False, "excessive_repetition"

    # Check for form field content
    form_indicators = [
        "Yes No",
        "please provide",
        "please indicate",
        "please select",
        "If yes,",
        "If no,",
        "Do you have a valid",
        "Are you willing",
    ]
    form_count = sum(1 for ind in form_indicators if ind.lower() in s.lower())
    if form_count >= 2:
        return False, "form_content"

    return True, None


def clean_summary_output(summary: str) -> str:
    """Post-process the summary to remove artifacts."""
    if not summary:
        return summary

    s = summary.strip()

    # Remove everything after "Human:" if present
    if "Human:" in s:
        s = s.split("Human:")[0].strip()

    # Remove meta-commentary sentences
    sentences = re.split(r'(?<=[.!?])\s+', s)
    clean_sentences = []
    for sent in sentences:
        sent_lower = sent.lower()
        skip = any(x in sent_lower for x in [
            "note:", "word count", "this summary", "please let me know",
            "can you provide", "i hope this", "let me know if"
        ])
        if not skip:
            clean_sentences.append(sent)

    s = " ".join(clean_sentences).strip()

    # Ensure it ends with proper punctuation
    if s and s[-1] not in ".!?":
        # Find last complete sentence
        last_period = max(s.rfind('.'), s.rfind('!'), s.rfind('?'))
        if last_period > len(s) * 0.5:  # At least half the content
            s = s[:last_period + 1]

    return s.strip()


# =========================
# Summarization
# =========================

SYSTEM_PROMPT = """You are a helpful assistant that summarizes academic job postings.
Output ONLY the summary, nothing else. No commentary, no questions, no meta-text.
Keep it factual and concise: 2-3 sentences covering the position, department, and key requirements."""

def build_prompt(page_text: str, title: Optional[str] = None) -> str:
    """Build a clear, structured prompt for the LLM."""
    title_hint = f"Position: {title}\n" if title else ""
    return f"""<|im_start|>system
{SYSTEM_PROMPT}<|im_end|>
<|im_start|>user
{title_hint}Summarize this academic job posting in 2-3 sentences:

{page_text[:3000]}<|im_end|>
<|im_start|>assistant
"""


def summarize_one(job: Job, max_new_tokens: int, model=None, tokenizer=None, device=None) -> dict:
    model = model or globals().get('model')
    tokenizer = tokenizer or globals().get('tokenizer')
    device = device or globals().get('DEVICE', 'cpu')

    # Use description from scraper if available (for JS-rendered sites like CUNY)
    # Skip fetching for domains with aggressive rate limiting
    # Otherwise fetch the page directly
    if job.description and len(job.description) > 200:
        html = None
        raw_text = job.description
        page_text = clean_page_text_for_llm(raw_text)
    elif should_skip_fetch(job.url):
        # Skip fetching - extract info from title only
        html = None
        raw_text = job.title or ""
        page_text = raw_text
    else:
        html = fetch_job_page_html(job.url)
        raw_text = extract_visible_text(html or "")
        page_text = clean_page_text_for_llm(raw_text)

    title_from_page, dept = extract_uc_recruit_title_dept(html or "")
    # Validate page-extracted title: prefer scraper title if page title looks bad
    if title_from_page and not is_valid_title(title_from_page):
        title_from_page = None
    original_title = title_from_page or clean_title_jobcode(job.title)
    # Strip extraneous info (academic years, semesters, etc.)
    cleaned_title = strip_extraneous_title_info(original_title)

    # Try multiple sources for department (including compound title extraction)
    dept = (
        dept
        or extract_department_from_compound_title(cleaned_title)
        or infer_department_from_title(cleaned_title)
        or extract_department_from_text(page_text)
    )
    rank = guess_rank(page_text) or guess_rank(cleaned_title or "")

    # Extract specific position/specialization (e.g., "Mathematics Education" within Dept of Education)
    specialization = extract_specialization(cleaned_title, page_text)

    # Create concise title: "Rank - Specialization" (or "Rank - Department" if no specialization)
    title_clean = make_concise_title(rank, dept, specialization, cleaned_title)

    # Safety net: if titleClean is still bad, recompute from scraper title
    if title_clean == "(No title)" and job.title:
        scraper_title = strip_extraneous_title_info(clean_title_jobcode(job.title))
        fallback_rank = guess_rank(scraper_title or "")
        fallback_dept = infer_department_from_title(scraper_title) or extract_department_from_compound_title(scraper_title)
        fallback_spec = extract_specialization(scraper_title, None)
        title_clean = make_concise_title(fallback_rank, fallback_dept, fallback_spec, scraper_title)
        if not rank and fallback_rank:
            rank = fallback_rank
        if not dept and fallback_dept:
            dept = clean_field_name(fallback_dept)
        if not specialization and fallback_spec:
            specialization = clean_field_name(fallback_spec)

    tenure_track = detect_tenure_track(page_text)
    deadline_info = extract_close_date(page_text)

    # Clean department and specialization fields to remove rank-related junk
    dept = clean_field_name(dept)
    specialization = clean_field_name(specialization)
    # Apply proper title case
    if dept:
        dept = to_title_case(dept)
    if specialization:
        specialization = to_title_case(specialization)

    if not rank:
        return {
            "summary": None,
            "titleClean": title_clean,
            "department": dept,
            "specialization": specialization,
            "rank": None,
            "tenureTrack": tenure_track,
            "closeDate": deadline_info.get("closeDate"),
            "closeDateType": deadline_info.get("closeDateType"),
            "closeDateRaw": deadline_info.get("closeDateRaw"),
            "openUntilFilled": deadline_info.get("openUntilFilled"),
            "skippedReason": "rank_not_identified",
            "enrichedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    # Build structured prompt
    prompt = build_prompt(page_text, cleaned_title)
    inputs = tokenizer(prompt, return_tensors="pt").to(device)

    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            eos_token_id=tokenizer.eos_token_id,
            pad_token_id=tokenizer.eos_token_id,
        )

    # Slice off input tokens so we only decode the newly generated summary
    raw_summary = tokenizer.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True).strip()

    # Clean and validate
    summary = clean_summary_output(raw_summary)
    is_valid, invalid_reason = validate_summary(summary)

    if not is_valid:
        return {
            "summary": None,
            "titleClean": title_clean,
            "department": dept,
            "specialization": specialization,
            "rank": rank,
            "tenureTrack": tenure_track,
            "closeDate": deadline_info.get("closeDate"),
            "closeDateType": deadline_info.get("closeDateType"),
            "closeDateRaw": deadline_info.get("closeDateRaw"),
            "openUntilFilled": deadline_info.get("openUntilFilled"),
            "skippedReason": f"invalid_summary_{invalid_reason}",
            "enrichedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    return {
        "summary": summary,
        "titleClean": title_clean,
        "department": dept,
        "specialization": specialization,
        "rank": rank,
        "tenureTrack": tenure_track,
        "closeDate": deadline_info.get("closeDate"),
        "closeDateType": deadline_info.get("closeDateType"),
        "closeDateRaw": deadline_info.get("closeDateRaw"),
        "openUntilFilled": deadline_info.get("openUntilFilled"),
        "enrichedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

if _STANDALONE:
    @app.post("/summarize")
    def summarize(req: SummarizeRequest):
        out = []
        for job in req.jobs:
            k = key_for(job)
            if k in CACHE:
                out.append({**job.dict(), **CACHE[k]})
                continue
            enriched = summarize_one(job, req.max_new_tokens or 220)
            CACHE[k] = enriched
            out.append({**job.dict(), **enriched})
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(CACHE, f, indent=2)
        return {"jobs": out}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("summarizer_gpu:app", host="0.0.0.0", port=PORT, workers=1)
