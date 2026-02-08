
# Local GPU LLM summarization using Transformers + bitsandbytes (no OpenAI)
import os, json, time, hashlib, re
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig

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
    # Decode HTML entities
    t = t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'").replace("&quot;", '"')
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
    if page_text:
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
                if spec and len(spec) > 3:
                    return spec

    return None

def extract_department_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    for label in ["Discipline", "Department", "Program", "School"]:
        m = re.search(rf"{label}\s*:\s*([A-Za-z&/ ,\-]{{2,80}})", text, flags=re.I)
        if m:
            return m.group(1).strip()
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


def make_concise_title(rank: Optional[str], dept: Optional[str], specialization: Optional[str], original_title: Optional[str]) -> str:
    """
    Create a concise title in format: Rank - Specialization
    Falls back to: Rank - Department, then just Rank, then original title.

    Specialization is more specific (e.g., "Mathematics Education")
    Department is broader (e.g., "Education")
    """
    # Prefer specialization over department since it's more specific
    field = specialization or dept

    if rank and field:
        return f"{rank} - {field}"
    if rank:
        return rank
    if field:
        return field
    return original_title or "(No title)"

# =========================
# Fetch helpers
# =========================

def fetch_job_page_html(url: str, timeout: float = 20.0) -> Optional[str]:
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            r = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            return r.text
    except Exception as e:
        print(f"[WARN] fetch failed {url}: {e}")
        return None

def extract_visible_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True))

# =========================
# FastAPI + model
# =========================

HF_MODEL = os.environ.get("HF_MODEL", "Qwen/Qwen2.5-3B-Instruct")
PORT = int(os.environ.get("SUMMARIZER_PORT", "9000"))
CACHE_PATH = os.path.join(".cache", "summaries.json")

os.makedirs(".cache", exist_ok=True)
try:
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        CACHE = json.load(f)
except Exception:
    CACHE = {}

app = FastAPI()

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

# 4-bit quantization config for faster inference and lower VRAM usage
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True,
)

tokenizer = AutoTokenizer.from_pretrained(HF_MODEL, use_fast=True)
tokenizer.pad_token = tokenizer.eos_token

# Load model with 4-bit quantization (requires GPU with CUDA)
if torch.cuda.is_available():
    print(f"[INFO] Loading {HF_MODEL} with 4-bit quantization on GPU: {torch.cuda.get_device_name(0)}")
    model = AutoModelForCausalLM.from_pretrained(
        HF_MODEL,
        quantization_config=bnb_config,
        device_map="auto",
    )
else:
    print(f"[WARN] No GPU detected, loading {HF_MODEL} on CPU (will be slower)")
    model = AutoModelForCausalLM.from_pretrained(HF_MODEL)

model.config.pad_token_id = tokenizer.eos_token_id

# =========================
# Summarization
# =========================

def summarize_one(job: Job, max_new_tokens: int) -> dict:
    html = fetch_job_page_html(job.url)
    page_text = extract_visible_text(html or "")

    title_from_page, dept = extract_uc_recruit_title_dept(html or "")
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

    tenure_track = detect_tenure_track(page_text)
    deadline_info = extract_close_date(page_text)

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

    prompt = f"Summarize the following academic job posting in 2–3 sentences:\n\n{page_text[:3500]}"
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            eos_token_id=tokenizer.eos_token_id,
        )

    # Slice off input tokens so we only decode the newly generated summary
    summary = tokenizer.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True).strip()

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
    uvicorn.run("summarizer_gpu:app", host="127.0.0.1", port=PORT, workers=1)
