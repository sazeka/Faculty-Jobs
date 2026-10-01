import crypto from 'node:crypto'
import { isExpiredPastGrace } from './post-expiration.js'
import { cleanDepartment } from './department-clean.js'
import { isChallengeDescription } from './description-quality.js'

export const POST_QUALITY_VERSION = 1

const PLACEHOLDER_TITLE_RE = /^(?:faculty|staff|faculty jobs|employment|careers?|view details|learn more|read more|click here)$/i
const RESOURCE_TITLE_RE = /^(?:\/?\s*faculty\s*(?:\/|&|and)\s*staff(?:\s+(?:resources?|panel))?|faculty careers?|faculty handbook|faculty affairs|faculty support|faculty support services\b.*|faculty resources?|faculty development|academic affairs|human resources|office of faculty affairs(?:\s*&\s*strategic planning)?|contract faculty payroll calendar|staff,? faculty (?:&|and) student employment opportunities|view lecturer opportunities|access center resources for faculty|affiliate faculty resources|center for faculty excellence|faculty accompanying students(?: \(fas\))? grant|faculty awards|faculty employment handbook|faculty forms|faculty offer letter templates\b.*|faculty performance|faculty review|(?:msu denver )?faculty fellowships|recruiting excellent faculty workshops|academic leadership (?:&|and) faculty|faculty experience|faculty overview)$/i
// Additional exact informational-page shapes found in the live unresolved
// appointment-track pool. These titles name governance documents, employee
// portals, directories, or general faculty resources -- never an individual
// vacancy. Keep the expression whole-title anchored so real appointments such
// as "Associate Dean for Faculty Affairs" and "E-Resource Librarian/Instructor"
// are not affected merely because they contain one of the same nouns.
const INFORMATIONAL_FACULTY_TITLE_RE = /^(?:academic affairs available faculty positions|all faculty\s*(?:&|and)\s*staff resources|allocation of faculty resources|becoming a faculty member|directory \(faculty\s*(?:&|and)\s*staff\)|faculty\s*(?:&|and)\s*(?:employee|staff) handbook|faculty\s*(?:&|and)\s*staff email|faculty and staff human resources guide(?:: employment)?|faculty and staff-student non-fraternization policy|faculty applicants?(?: should use this form)?|faculty bylaws|faculty center(?: for innovation)?|faculty committees?|faculty credentialing policy|faculty email|faculty employment handbook change proposal dates.*|faculty forms\s*(?:&|and)\s*resources.*|faculty governance(?: and committees)?|faculty handbook\s*(?:&|and)\s*professional development|faculty handbook-springfield|faculty housing|faculty manual|faculty online resources|faculty policies(?: and procedures)?|instructor resources for online learning|new faculty resources|office of faculty resources|online faculty resources|procedures and responsibilities regarding faculty|prospective faculty resources|resources for (?:early-career )?faculty|section ii:\s*faculty|sexual misconduct policy for students, faculty, and staff|staff\s*(?:&|and)\s*faculty committees|student,? faculty(?:,?\s*(?:&|and)\s*staff)? internal resources|student,? faculty,?\s*(?:&|and)\s*staff resources|teaching faculty policy handbook)$/i
const FACULTY_EMPLOYMENT_LANDING_TITLE_RE = /^faculty employment opportunities$/i
// Additional whole-page labels uncovered by the next unresolved-pool audit.
// These are institutional information, recognition, policy, or login pages,
// not vacancy titles. Keep the shapes anchored and enumerated: generic job
// titles such as "Nursing Faculty" and "Faculty Member, Biology" must remain
// eligible.
const FACULTY_INFORMATION_PAGE_TITLE_RE = /^(?:\/careers\/faculty\.php|(?:\d{4}\s+)?faculty appreciation awards?|faculty salary scale|(?:administration|administration, leadership)\s*(?:&|and)\s*faculty|current faculty(?:\s*\/\s*staff)?|emeritus faculty|faculty emerit(?:us|i\/ae)|faculty remembrances|faculty roster|employee\s*\/\s*faculty handbooks?|faculty\s*(?:&|and)\s*(?:board members|leadership|members|professional application|research|residents|scholars|scholarship|staff benefits|staff dashboard|staff forms|staff gateway|staff login|staff menu)|faculty and course profiles|faculty bookstore login|faculty employment application|faculty gateway|faculty handbooks?|faculty online application|faculty pic application|faculty research(?:\s*(?:&|and)\s*publications| forum)?|faculty scholarship|faculty teaching award recipients|faculty textbook order form|full[- ]time faculty benefits|hiring faculty:\s*manual and resources|leadership\s*(?:&|and)\s*faculty|program leadership\s*(?:&|and)\s*faculty|special appointment faculty resources|sponsored faculty research|student[-\/]faculty (?:login|research)|terms and conditions of employment of faculty members)$/i
// A further reviewed batch of exact navigation, news, recognition, employee-
// service, and research-index labels. This deliberately avoids broad matches
// on words such as "research", "staff", or "campus" so substantive academic
// appointments containing those words remain publishable.
const REVIEWED_FACULTY_INFORMATION_TITLE_RE = /^(?:administraton, leadership\s*(?:&|and)\s*faculty|african american faculty\s*(?:&|and)\s*staff coalition|award-winning faculty|christopher newport university is a special place\..*|clinical\/professional faculty appointment and promotion|college of the siskiyous paramedic program instructor theresa gowan honored with statewide clinical excellence award|daisy award for nursing faculty|disability and accessibility resources for faculty|employment opportunities :: category - faculty|faculty and clinical specialists|faculty assisted at healthcare careers camp for high school students|faculty comprehensive checklist|faculty emeritus\/emerita guidelines|faculty expectations|faculty in the news|faculty life\s*(?:&|and)\s*development|faculty positions\s*(?:&|and)\s*hiring|faculty recruiting guidelines|faculty rules of procedure|faculty self service banner \(ssb9\)|faculty services|faculty spotlight|faculty\/staff (?:login|navigate login)|faculty publications?|faculty publication index|faculty researchers|faculty-led research|faculty\s*\/\s*staff remote email|faculty\/staff email|faculty\s*(?:&|and)\s*staff (?:assistance office|canvas information|compensation and classification study|development|downloads|engagement|giving|guide to title ix|info|intranet|links|mail services|member|mentor program|mentors|news|page|parking|positions\s*>|resources click to collapse click to expand|website)|faculty\s*\+\s*staff|faculty\/staff member|faculty or staff member|faculty campus connect|faculty, staff, and students|for faculty|full time faculty expectations|harold washington college professor honored with national maxwell\/hanrahan award in craft|lecturer hire document checklist|national applied ai consortium spotlights wright college professor gustavo alatta|plan for determining the effectiveness of student and faculty services|professional development for dance instructors|professor melda beaty’s sabbatical revives play production course at olive-harvey and playwriting award|spotlight on faculty culture|the west shore community college benefits in brief document offers detailed information regarding benefits to full-time administrators, faculty, and educational support staff\.|toggle faculty professional development menu)$/i
const REVIEWED_NON_POSTING_EXACT_TITLES = new Set([
  '▷ students & faculty',
  'a faculty for the church',
  'a faculty guide to ethical and legal standards in student hiring',
  'about mcc faculty',
  'ai use: a how-to guide for instructors',
  'allied faculty',
  'asl faculty',
  'associate faculty salary schedule effective 7.1.2026',
  'caring faculty',
  'center for institutional, faculty, and student success',
  'coa faculty application',
  'council of university system faculty',
  'course information & faculty credentials (house bill 2504)',
  'deans and full-time faculty',
  'exceptional faculty',
  'expertise & faculty search',
  'faculty & administration',
  'faculty & advisors',
  'faculty & instructors',
  'faculty & inventors',
  'faculty & students',
  'faculty access',
  'faculty achievements',
  'faculty (3)',
  'faculty (11)',
  'faculty careers at st. thomas',
  'faculty job fair seeks passionate educators: join the river community!',
  'faculty jobs@uiowa',
  'faculty advising appointment scheduling',
  'faculty advisors',
  'faculty and academic deans',
  'faculty and academics',
  'faculty and advisory committee',
  'faculty and educational affiliates',
  'faculty and providers',
  'faculty annual report guide',
  'faculty application',
  'faculty career center',
  'faculty contract',
  'faculty credentials',
  'faculty distance education support',
  'faculty dual career and relocation services',
  'faculty employment',
  'faculty exchange',
  'faculty experts guide',
  'faculty fellows',
  'faculty finder',
  'faculty flashport',
  'faculty funding and support',
  'faculty guide to disability services',
  'faculty guide to ethical & legal standards in student hiring',
  'faculty guide to ethical and legal standards in student hiring',
  'faculty home',
  'faculty intellectual contributions',
  'faculty information',
  'faculty interviews',
  'faculty led travel',
  'faculty life',
  'faculty load pay dates',
  'faculty negotiated agreement',
  'faculty office hours (file download)',
  'faculty ombudsperson',
  'faculty pages',
  'faculty paws',
  'faculty qualifications & documentation required',
  'faculty meetings and activities calendar',
  'faculty meeting',
  'faculty mentoring guide',
  'faculty mentoring',
  'faculty olsis',
  'faculty pd calendar',
  'faculty recruitment guide',
  'faculty searches',
  'faculty sounding board',
  'faculty ssb',
  'faculty student exchange (fse)',
  'faculty student collaboration',
  'faculty testing services',
  'faculty training',
  'faculty unions',
  'faculty vitae',
  'faculty vacancy announcements',
  'faculty volunteer early retirement incentive',
  'faculty/staff career opportunities',
  'faculty/staff dialogues',
  'faculty/staff giving',
  'faculty/staff j1 web',
  'faculty/staff opportunities',
  'faculty/staff portal (okta dashboard)',
  'for faculty: course adoptions',
  'full-time faculty & instructional staff',
  'featured faculty',
  'full-time faculty non-teaching salary schedule effective 7.1.2025 approved 1.15.2026',
  'full-time faculty teaching salary schedule effective 7.1.2025 approved 1.15.2026',
  'general employment application - administration or faculty',
  'get support for instructional faculty icon',
  'guide for faculty',
  'instructional/faculty support7 available jobs',
  'innovative faculty',
  'my faculty jobs',
  'pnw faculty',
  'faculty, physician and psychologist jobs',
  'welcome to the johns hopkins university faculty careers site',
  'unt faculty',
  'information for faculty',
  'inside chapman (faculty & staff)',
  'leaders, faculty, staff & board',
  'library services for faculty',
  'minimum qualifications for faculty and administrators in california community colleges',
  'msu denver faculty federation',
  'music faculty achievements',
  'new faculty information',
  'nyu abu dhabi proposal form for nyu faculty: academic year',
  'open employee (non-faculty) positions',
  'professional conduct review for new faculty hires',
  'request tracking system (rts) - faculty hiring proposal',
  'sample faculty reference letter',
  'search staff, faculty, and student positions',
  'staff & faculty publications',
  'staff & full-time faculty jobs',
  'staff and faculty orientation',
  'staff and faculty relations services',
  'staff/faculty webmail',
  'student faculty & staff library access',
  'students, faculty & researchers',
  'students, faculty, and staff',
  'through community and faculty mentorship, flc students find purpose and support at flc',
  'total compensation for full-time faculty',
  '10 questions with... diana rohlman, associate professor and senior researcher in the department of environmental and molecular toxicology link is external',
  'aha instructor classes',
  'class search, course syllabi, and instructor information (hb 2504)',
  'faculty & professor page',
  'faculty absences',
  'faculty assembly',
  'faculty blog',
  'faculty blogs',
  'faculty books',
  'faculty cms sign on',
  'faculty code',
  'faculty compliance',
  'faculty constitution',
  'faculty credentialing review process',
  'faculty ctl',
  'faculty curricula vitae',
  'faculty experts hub',
  'faculty faqs',
  'faculty misconduct',
  'faculty labs',
  'faculty mentorship',
  'faculty mentorships',
  'faculty online',
  'faculty position openings',
  'faculty-student collaboration',
  'global language faculty',
  'gove county faculty',
  'honors faculty',
  'instructor approved pre-requisite override',
  'instructor approved prerequisite override',
  'instructor authorized exams',
  'instructor qualifications and credentialing requirements',
  'lay formation faculty',
  'mentored faculty programs',
  'music faculty',
  'music program faculty',
  "o'leary travel grants for faculty",
  'online ce instructors',
  'professors emeriti',
  'research appointments for faculty',
  'research with faculty',
  'sandburg faculty',
  'seminary faculty',
  'theatre program faculty',
  'united faculty of florida',
  'university transfer faculty',
  'welcoming seven new faculty members',
  'west virginia professor of the year',
  'ar professor of the year',
  'atlanta’s john marshall law school welcomes an array of new faculty for fall 2026',
  'cdl instructor qualification form',
  'college of medicine available faculty positions',
  'cypress college professor foster stanback named 2027 orange county teacher of the year nominee',
  'endowed chairs and professors',
  'faculty (business, media & writing)',
  'faculty (education & humanities)',
  'faculty (equine)',
  'faculty (fine arts & theatre)',
  'faculty (nhsb sciences)',
  'faculty diversity internship program (fdip)',
  'faculty hiring process',
  'faculty members',
  'faculty office hours',
  'faculty positions (herc)',
  'faculty positions, latest positions page 1',
  'faculty, lecturer, and academic staff jobs',
  'in memory of dr. israel loken (1968-2026) chair, bible and theology departments; senior professor',
  'instructional faculty',
  'ma degree program faculty',
  'ma transformational teaching, learning, & leadership faculty',
  'malcolm x college instructor wins prestigious poetry prize',
  'martin university faculty',
  'memorial service honoring dr. reddy s. gurramkonda, professor of biology june 15, 2026 at 10:00 am',
  'music instructor hiring process',
  'no days off: aviation faculty member runs summer camp for small pilots',
  'núria rodríguez-planas is named a distinguished professor',
  'oriental medicine faculty',
  'phd faculty',
  'pontifical faculty of theology',
  'priestly formation faculty',
  'professor erin corken publishes two-part series on ai ethics and legal practice',
  'professor lance mcmillian discusses writing and ai at georgia supreme court and court of appeals',
  'resident faculty',
  'stony brook faculty positions',
  'upstate faculty positions available web site',
  'vice president for ethics and compliance faculty search and screen',
  'western medicine faculty',
  'ysu faculty syllabi',
  'assistant to dean- college of medicine',
  'assistant to the dean',
  'bulldog club (fellow)',
  'director of faculty practice operations, dental',
  'director, center for applied artificial intelligence/ faculty program director',
  'patient care academy instructor',
  'registered nurse instructor',
  'riding instructor/eventing coach',
  'welding instructor and lab specialist',
  'workforce instructor',
  'dean of enrollment and marketing',
  'k14 workforce program manager — 270101 - eas mcecs dean maseeh college',
  'program manager 1 - graduate and professional programs',
  'program manager l3 - (manager of faculty awards, titles, and recognition)',
  "shiley dean's office student assistant",
  'senior director credentialing & contracting (hybrid) - faculty practice plan',
  'senior policy & research manager, office of the faculty director',
  'student affairs & dean of students',
  'student affairs-dean of students office',
  'systems analyst 2 - college of pharmacy',
  'vice president of student affairs & dean of students',
  "vsb dean's office student assistant",
  'vp/dean of students',
])
const SEARCH_PAGE_CHROME_TITLE_RE = /^(?:faculty (?:&|and|\+) staff(?: jobs| resources| employment)?|faculty and staff faqclick to open|faculty and staff human resources guide: employment|faculty employment|faculty stories|faculty, lecturer, and academic staff jobs|faculty\/staff resources|full-time faculty|prospective faculty & staff|regular faculty and staff|staff and faculty)$/i
// Exact information-page labels observed in institution navigation and news
// feeds. These pages discuss current faculty, policies, awards, resources, or
// professional development; none names an open appointment. Keep this list
// exact so genuine titles such as "Faculty, Nursing" remain eligible.
const NON_POSTING_INFORMATION_TITLE_RE = /^(?:\/careers\/faculty\.php|2021 Faculty Appreciation Awards|Academic Affairs Available Faculty Positions|AR Professor of the Year|ASL Faculty|Caring Faculty|Center for Institutional, Faculty, and Student Success|College of Medicine Available Faculty Positions|Current Faculty|Current Faculty\/Staff|Cypress College Professor Foster Stanback Named 2027 Orange County Teacher of the Year Nominee|Employee\/Faculty Handbooks|Exceptional Faculty|Expertise & Faculty Search|Faculty \(\d+\)|Faculty \((?:Business, Media & Writing|Education & Humanities|Equine|Fine Arts & Theatre|NHSB Sciences)\)|Faculty & Members|Faculty & Professor Page|Faculty & residents|Faculty & Students|Faculty Absences|Faculty Access|Faculty Advising Appointment Scheduling|Faculty Advisors|Faculty and Academic Deans|Faculty and Academics|Faculty and Course Profiles|Faculty and Providers|Faculty Blogs|Faculty Bylaws|Faculty Campus Connect|Faculty Careers at St\. Thomas|Faculty Code|Faculty Compliance|Faculty Constitution|Faculty Credentials|Faculty CTL|Faculty Curricula Vitae|Faculty Distance Education Support|Faculty Diversity Internship Program \(FDIP\)|Faculty Emeriti\/ae|Faculty Emeritus|Faculty Exchange|Faculty Experts Hub|Faculty Finder|Faculty FlashPort|Faculty Funding and Support|Faculty Gateway|Faculty Handbooks|Faculty Hard Copy Grades and Attendance Submission|Faculty Home|Faculty Inquiry Groups|Faculty Landing Page|Faculty Learning Communities|Faculty Led Travel|Faculty Life|Faculty Life & Development|Faculty Members|Faculty Mentoring|Faculty Mentorships|Faculty Misconduct|Faculty Office Hours|Faculty OLSIS|Faculty Online|Faculty or Staff Member|Faculty Positions & Hiring|Faculty Published Books|Faculty Remembrances|Faculty Researchers|Faculty Retirement Transition Leave|Faculty Roster|Faculty Sabbaticals|Faculty Speakers Bureau|Faculty Volunteer Early Retirement Incentive|Faculty-Student Mentors|Faculty\/Staff Dialogues|Faculty\/Staff Email|Faculty\/Staff J1 Web|Faculty\/Staff Member|Faculty\/Staff Opportunities|Featured Faculty|For Faculty|Full Time Faculty Expectations|Get Support for Instructional Faculty Icon|Honors Faculty|Innovative Faculty|Instructional Faculty|Leadership & Faculty|Martin University Faculty|MEMORIAL SERVICE HONORING Dr\. Reddy S\. Gurramkonda, Professor of Biology June 15, 2026 at 10:00 am|Mentored Faculty Programs|MQ’s for Faculty & Administrators|Music Faculty|Music Faculty Achievements|My Faculty Jobs|Núria Rodríguez-Planas is Named a Distinguished Professor|O'Leary Travel Grants for Faculty|Pontifical Faculty of Theology|Prospective Faculty|Sample Faculty Reference Letter|Sandburg faculty|Search Staff, Faculty, and Student Positions|Seminary Faculty|Staff & Faculty Committees|Staff and Faculty Orientation|Staff\/Faculty Webmail|Stony Brook Faculty Positions|Students, Faculty, and Staff|Through community and faculty mentorship, FLC students find purpose and support at FLC|Toggle Faculty Professional Development Menu|University Transfer Faculty|Welcoming Seven New Faculty Members|West Virginia Professor of the Year|YSU Faculty Syllabi)$/i
const NON_POSTING_NEWS_TITLE_RE = /^No Days Off: Aviation Faculty Member Runs Summer Camp for Small Pilots$/i;
// Directory/biography/overview/video pages ABOUT faculty as a group, not a
// specific role being recruited (issue #129). Deliberately narrow: "director"
// is excluded (only "directory"/"directories") because "Faculty Director of
// ..." is a real appointment title, and every keyword here is gated at the
// call site on the title NOT already containing a strong academic title, so
// a real posting that happens to also mention e.g. a video interview isn't
// caught.
const FACULTY_RESOURCE_KEYWORD_RE = /\b(?:faculty|academic)\b[^.!?]*\b(?:directory|directories|biograph(?:y|ies)|overview|videos?)\b/i
// Explicit appointment-form prefixes that name a real role being recruited
// take precedence over FACULTY_RESOURCE_KEYWORD_RE, even though the rest of
// the title may include a word ("Video", "Overview") the resource-keyword
// heuristic would otherwise treat as directory/marketing-page evidence
// (issue #149 -- e.g. "Adjunct Faculty, Film and Video" or "Adjunct Faculty,
// Online Course (SPAC 500 - Overview of the Space Ecosystem...)"). Narrowly
// scoped to these two well-established posting-title conventions (see
// STRONG_ACADEMIC_TITLE_RE / EVERGREEN_POOL_RE for the "Applicant Pool"
// convention already recognized elsewhere in this codebase) so it doesn't
// blanket-exempt every title starting with the word "faculty".
const EXPLICIT_ADJUNCT_APPOINTMENT_RE = /^(?:adjunct faculty\b|applicant pool for adjunct faculty\b)/i
// Informational "how to apply" / applicant-guidance pages name faculty
// applicants as an audience, not a specific position (issue #129 -- St.
// John's College "Information for Santa Fe Faculty Applicants"). Restricted
// to this "information for ... applicants" shape so it doesn't catch a real
// "<Position> Applicant Pool" posting title (an established convention for
// standing adjunct pools elsewhere in this codebase -- see EVERGREEN_POOL_RE
// below).
const APPLICANT_INFORMATION_PAGE_RE = /\b(?:information|instructions|guidance)\s+for\b[^.!?]*\bapplicants?\b/i
// Admissions/marketing copy that happens to mention faculty in passing is not
// a job posting (issue #129 -- Southeastern Baptist's campus-visit page).
const CAMPUS_VISIT_MARKETING_RE = /\bexplore campus\b|\bmeet (?:our\s+)?faculty\b/i
// Explicit "do not apply" / test-record language is decisive regardless of
// any other title evidence (issue #129 -- Centre College's "New Test for
// Faculty — Do NOT Apply" scored 99/pass).
const TEST_OR_PLACEHOLDER_TITLE_RE = /\bdo[\s-]*not[\s-]*apply\b/i
// "Dean" alone is weak evidence: it also appears in incidental
// reporting-relationship phrases like "Executive Assistant to the Dean" or
// "reports to the Dean", where the role actually being recruited is the
// assistant, not the dean (issue #129 -- Howard Community College's "Office
// Manager and Executive Assistant to the Dean" scored 100/pass on this false
// match). Require the title to actually BE a dean role, not merely name one
// as who the position reports to.
const DEAN_TITLE_RE = /\b(?:assistant|associate)?\s*dean\b/i
const DEAN_REPORTING_RELATIONSHIP_RE = /\b(?:to|for|of|under)\s+(?:the\s+)?(?:assistant|associate)?\s*dean\b/i
const STRONG_ACADEMIC_TITLE_RE = /\b(?:assistant|associate|full|distinguished|endowed|visiting|adjunct|clinical|research|teaching)?\s*professor\b|\bprofessor of\b|\blecturer\b|\binstructor\b|\bpost[- ]?doctoral\b|\bpost[- ]?doc\b|\bfaculty fellow\b|\bresearch (?:scientist|associate|fellow)\b|\bdepartment chair\b|\b(?:academic|assistant|associate|faculty) librarian\b/i
const STAFF_ROLE_RE = /\b(?:faculty affairs|faculty development|faculty support|human resources|hr associate|hr business|coordinator|specialist|recruiter|talent acquisition|administrative assistant|executive assistant|office manager|program assistant|assistant director|associate director|operations manager|business manager)\b/i
const CLEAR_NONACADEMIC_RE = /\b(?:custodian|groundskeeper|maintenance technician|police officer|security officer|bus driver|food service|payroll|accounts payable|facilities technician|electrician|plumber|carpenter|head coach|assistant coach|athletic trainer|student worker)\b/i
const CLEAR_NON_APPOINTMENT_TITLE_RE = /^(?:Assistant Dean of Student Affairs|Assistant Dean of Student Success|Assistant Dean of Students for Reslife\/Wellness|Assistant Dean, Faculty Affairs and Professional Development \(Revised\)|Assistant Provost for Academic Budgets & Faculty Relations|Assistant to the Department Chair|Associate Dean of Campus Operations|Associate Dean of Equity and Special Programs|Associate Dean of Students|Associate Dean of Studies|Associate Dean of Workforce \(Abilene\)|Associate Director for Faculty and Research Communications|Climbing Wall Student Instructor|Dean of Enrollment Management|Dean of Enrollment Management, Systems, and Innovation|Dean of Experiential Learning, Career Development and Employer Partnerships|Dean of Students, Ashley Curry|FitWell Group Exercise Instructor|Fitness Instructor|Fitness-Group Exercise Instructor|Personal Trainer, Duke Faculty Club|Research Professional 2 - Chemical Engineering - Professor Bruggeman|Riding Instructor\/Eventing Coach|Senior Director Credentialing & Contracting \(Hybrid\) - Faculty Practice Plan|Staff Instructor III\/EMT Program|Staff Instructor IV - Workforce|Staff Instructor Line Worker Hagerhill, KY Big Sandy Community & Technical College|Student Affairs & Dean of Students|Swim Instructor|Swim Instructor \/ Coach|Vice President of Student Affairs & Dean of Students|VP\/Dean of Students|Yoga Instructor, FitWell Group Exercise)$/i
const REVIEWED_NONACADEMIC_TITLE_RE = /^(?:Assistant International Faculty and Scholar Advisor|Director, Teaching & Research Faculty Compensation Strategy|Faculty and Student Support Associate|Faculty Information Services Specialist \(FIS\)|Faculty Services Assistant|Job Coach & PreEts Instructor, Toledo Transition, Seasonal|Night\/ Weekend On-Site Supervisor for the Duke Faculty Club|Personal Trainer, Duke Faculty Club|Student Worker - A&D Faculty Offices)$/i
const RECREATIONAL_INSTRUCTOR_RE = /\b(?:group fitness|fitness|group exercise|swim(?:ming lessons)?|learn to swim|water aerobics|water fitness|pickleball)\s+instructor\b/i
const STUDENT_RESOURCE_RE = /\b(?:student services|career services|career center|disability services|office for students|student employment|student fellow|fellow\s*\(student\)|academic advis(?:or|ing))(?:\b|$)/i
const APPOINTMENT_CONTEXT_RE = /\b(?:12[- ]month|adjunct|clinical|core|ft|full[- ]time|instructional|non[- ]tenure|ntt|open[- ]rank|part[- ]time|professional|rank (?:doq|open|tbd)|research|teaching|tenure(?:d|[- ]track)?)\b/i
const NON_APPOINTMENT_FACULTY_CONTEXT_RE = /\b(?:faculty affairs|faculty development|faculty recruitment|faculty shared services|faculty support|recruit(?:er|ing|ment))\b/i
const GENERIC_INSTITUTION_WORDS = new Set(['and', 'at', 'college', 'institute', 'of', 'school', 'system', 'the', 'university'])
// An explicit signal that a posting is a standing/evergreen recruitment pool
// rather than a single dated vacancy (issue #131) -- either the "Open Pool" /
// "Applicant Pool" title convention this codebase already recognizes
// elsewhere (see scripts/lib/weekly-tenure-stats.js and
// scripts/__tests__/weekly-tenure-stats.test.js), or prose stating
// applications are accepted on a rolling/continuous basis and candidates are
// contacted as needs arise (the Villanova adjunct-pool example in the
// issue). `openUntilFilled` alone is deliberately NOT treated as this signal
// -- the issue is explicit that a multi-year-old individual search marked
// merely "Open Until Filled" (the UNC Nutrigenomics example) is not proof of
// an evergreen pool.
const EVERGREEN_POOL_RE = /\bopen pool\b|\bapplicant pool\b|\bstanding pool\b|\bpool of (?:qualified )?(?:applicants|candidates)\b|\brolling basis\b|\bcontinuous(?:ly)?\s+(?:accept|recruit)/i
const EVERGREEN_STATEMENT_RE = /\baccepts?\s+applications\b.{0,40}\b(?:any time|year[- ]round|on an? ongoing basis|continuously)\b|\bcontact(?:s|ed)?\b.{0,40}\bwhen\b.{0,40}\b(?:need|opening|position)s?\b.{0,20}\barises?\b/i
// Graduated freshness deductions for postings whose datePosted is old and
// that carry no evergreen/pool signal (issue #131). Ordered from largest
// threshold to smallest so the first match is the correct (largest) tier.
// The 1-2yr tier is 'info' severity (dings the score but doesn't by itself
// push a listing out of 'pass'); 2yr+ is 'warning' (forces 'review' so it
// gets re-verified), matching how every other freshness/relevance warning in
// this function behaves.
const AGE_FRESHNESS_TIERS = [
  { years: 5, code: 'stale_posting_no_evergreen_signal', severity: 'warning', deduction: 40 },
  { years: 2, code: 'stale_posting_no_evergreen_signal', severity: 'warning', deduction: 25 },
  { years: 1, code: 'aging_posting_no_evergreen_signal', severity: 'info', deduction: 10 },
]
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000
// A Department of Labor / OFLC "Notice of Filing" is a mandatory compliance
// posting for a position that has already been filled -- not an open
// vacancy (issue #150). The title phrase alone is decisive (it's a specific,
// fixed regulatory-artifact label that doesn't occur in real appointment
// titles). At least one confirmed example (a UW-Eau Claire orchestra
// director posting) omits the phrase from its title entirely, so the same
// signal is also recognized from the description's own boilerplate: the
// combination of "position has been filled" with either "posting is
// mandatory" or an explicit Department of Labor reference. Requiring both
// halves of that combination (rather than "position has been filled" alone)
// keeps this scoped to the specific compliance-notice pattern the issue
// describes, not any closed/filled posting in general.
const NOTICE_OF_FILING_TITLE_RE = /\bnotice of filing\b/i
// Deliberately "has been filled" only, not "is filled" -- ordinary open
// postings routinely say applications will be reviewed "until the position
// is filled" (a still-open, ongoing search), which is the opposite meaning
// of the compliance notice's "please do not apply ... it has been filled."
const FILLED_COMPLIANCE_NOTICE_RE = /\bposition\s+(?:as\s+it\s+)?has\s+been\s+filled\b/i
const MANDATORY_COMPLIANCE_LANGUAGE_RE = /\bposting\s+is\s+mandatory\b|\brequired?\s+by\s+(?:the\s+)?(?:u\.?s\.?\s+)?department\s+of\s+labor\b|\bmeet\s+a\s+(?:united\s+states\s+|u\.?s\.?\s+)?department\s+of\s+labor\s+requirement\b/i
// "Faculty & Staff" / "Faculty and Staff" / "Faculty + Staff" page titles are
// almost always directories, portals, handbooks, benefits pages, or rosters
// -- not a specific role being recruited (issue #153). An explicit
// appointment/hiring term in the title (or an already-recognized strong
// academic title) overrides this: it means the title is a real posting that
// merely uses inclusive "faculty and staff" audience language (e.g. benefits
// eligibility), matching the issue's own audit methodology, which excluded
// titles containing "professor, lecturer, instructor, position, job,
// employment, opening" from its confirmed false-positive count.
const FACULTY_STAFF_RESOURCE_TITLE_RE = /\bfaculty\s*(?:&|and|\+)\s*staff\b/i
const FACULTY_STAFF_APPOINTMENT_OVERRIDE_RE = /\b(?:professors?|lecturers?|instructors?|positions?|jobs?|employment|openings?|appointments?|adjuncts?|vacanc(?:y|ies)|hiring|tenure(?:d|[- ]track)?)\b/i

function isFilledComplianceNotice(title, description) {
  if (NOTICE_OF_FILING_TITLE_RE.test(title)) return true
  return FILLED_COMPLIANCE_NOTICE_RE.test(description) && MANDATORY_COMPLIANCE_LANGUAGE_RE.test(description)
}

function hasDeanAppointmentTitle(title) {
  return DEAN_TITLE_RE.test(title) && !DEAN_REPORTING_RELATIONSHIP_RE.test(title)
}

function hasEvergreenPoolSignal(title, description) {
  const hay = `${title} ${description}`
  return EVERGREEN_POOL_RE.test(hay) || EVERGREEN_STATEMENT_RE.test(hay)
}

// Two reviewed institutional crawls admitted department faculty rosters as
// vacancies. Scope this repair to their known academic-directory trees so a
// real posting titled "Faculty, Accounting" on an ATS is never affected.
function isReviewedInstitutionFacultyDirectory(job) {
  const college = clean(job?.college)
  const title = clean(job?.title)
  const url = clean(job?.url)
  if (college === 'Covenant Theological Seminary' && /^Professor of New Testament$/i.test(title)) return true
  if (college === 'College of Biblical Studies-Houston' && /^Dr\..*\bProfessor\b/i.test(title)) return true
  if (college === 'Western Michigan University Homer Stryker M.D. School of Medicine' && /^Executive Faculty$/i.test(title)) return true
  if (college === 'Appalachian School of Law' && /^Faculty Assistant$/i.test(title)) return true
  if (college === 'College of Biblical Studies-Houston' && /^Full-time Faculty$/i.test(title)) return true
  if (college === 'Malone University' && /^Full-time Faculty$/i.test(title)) return true
  if (college === 'New England College of Optometry' && /^Research Faculty$/i.test(title)) return true
  if (college === 'Southern College of Optometry' && /^Research Faculty$/i.test(title)) return true
  if (college === 'Northwest Mississippi Community College' && /^Fine Arts Faculty$/i.test(title)) return true
  if (!/\bfaculty\b/i.test(title)) return false
  if (college === 'Brookdale Community College') {
    return /^https:\/\/(?:www\.)?brookdalecc\.edu\/academic-institutes-and-departments\//i.test(url)
  }
  if (college === 'Northeastern Illinois University') {
    return /^https:\/\/(?:www\.)?neiu\.edu\/academics\/colleges-departments\//i.test(url)
  }
  if (college === 'West Shore Community College' && /^Full Time Faculty$/i.test(title)) {
    return /\/Benefit-Summary-Faculty-\d{4}\.pdf(?:$|\?)/i.test(url)
  }
  if (college === 'Southern College of Optometry' && /^Residency Faculty$/i.test(title)) return true
  return false
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function dateOnly(value) {
  const raw = clean(value)
  if (!raw) return null
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function institutionTokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !GENERIC_INSTITUTION_WORDS.has(token))
}

function explicitInstitutionInTitle(title) {
  const segments = clean(title).split(/\s+[—–-]\s+/).slice(1)
  for (const segment of segments.reverse()) {
    const match = segment.match(/\b(University\s+of\s+[A-Z][A-Za-z0-9&.'’()-]*(?:\s+(?:at|and|the|[A-Z][A-Za-z0-9&.'’()-]*)){0,6})\s*$/)
      || segment.match(/\b([A-Z][A-Za-z0-9&.'’()-]*(?:\s+(?:of|the|and|at|in|for|[A-Z][A-Za-z0-9&.'’()-]*)){1,9}\s+University)\s*$/)
    if (match) return clean(match[1])
  }
  return null
}

// A `location` that's just the institution's own name plus a state suffix
// ("Wilson Community College, NC", "Harvard University, MA") is a
// placeholder, not a real city — it passes a plain non-empty check, which
// undercounts how many jobs actually lack a usable location (issue #120).
// This is a whole-name check (not a token-overlap one) because several
// real institutions are named after — and legitimately located in — a city
// of the same name (Santa Clara University → "Santa Clara, CA", University
// of Houston → "Houston, TX", Radford University → "Radford, VA", Villanova
// University → "Villanova, PA"): those are correct, real locations, and a
// looser "location's words are a subset of college's words" check would
// wrongly flag every one of them as a placeholder.
//
// Some locations legitimately use a "Main Campus - City, ST" convention
// (e.g. "Saint Joseph's University - Lancaster, PA" for a real satellite
// campus) where the college name itself happens to embed that campus
// suffix, making the *whole* location string equal `${college}, ${state}`
// even though a real city follows the dash — so only the last " - "
// segment is compared, matching how the frontend already parses this.
export function isPlaceholderLocation(location, college) {
  const col = clean(college)
  const loc = clean(location)
  if (!col || !loc) return false
  const segments = loc.split(' - ')
  const last = clean(segments[segments.length - 1])
  const stateMatch = last.match(/,\s*([A-Za-z]{2})$/)
  const locationName = stateMatch ? clean(last.slice(0, stateMatch.index)) : last
  const identity = (value) => clean(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\buniv\b/g, 'university')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return identity(locationName) === identity(col)
}

function institutionConflict(title, college) {
  // A few scrapers truncate a trailing institution phrase at "University of".
  // Treat that as incomplete page text, not as evidence naming another school.
  if (/\bUniversity\s+of\s*$/i.test(clean(title))) return null
  const explicit = explicitInstitutionInTitle(title)
  if (!explicit || !clean(college)) return null
  const expected = new Set(institutionTokens(explicit))
  const actual = new Set(institutionTokens(college))
  if (!expected.size || !actual.size) return null
  return [...expected].some((token) => actual.has(token)) ? null : explicit
}

function classifyLink(url) {
  let parsed
  try {
    parsed = new URL(clean(url))
  } catch {
    return 'invalid'
  }
  if (!/^https?:$/.test(parsed.protocol)) return 'invalid'
  const path = parsed.pathname.replace(/\/+$/, '').toLowerCase()
  const combined = `${path}${parsed.search}${parsed.hash}`
  const directJobPlatform = /(?:myworkdayjobs|myworkdaysite|schooljobs|peopleadmin|interfolio|csod|oraclecloud)\./i.test(parsed.hostname)
  // CUNY's DirectEmployers pages intentionally end in `/job`; the UUID-like
  // segment immediately before it identifies one posting, not a search root.
  if (parsed.hostname === 'cuny.jobs' && /\/[a-f0-9]{16,}\/job$/i.test(path)) return 'direct'
  if (!directJobPlatform && /\/(?:directory|people|our-faculty|faculty-profiles?|faculty-staff|faculty-affairs|faculty-support|professional-development)\b/.test(path)) return 'resource-page'
  if (/hrs_(?:app_)?schjob|hrs_cg_search/.test(combined) && !/(?:jobopeningid|jobid|postingid)[=#]\d+/i.test(combined)) return 'search-page'
  if (/\/(?:jobs?|careers?|employment|postings?|search|openings?)$/.test(path) && !parsed.search && !parsed.hash) return 'search-page'
  return 'direct'
}

export function reviewedWeakEvidenceFalsePositiveReason(job) {
  const title = clean(job?.title)
  const url = clean(job?.url)

  if (/^(?:DEAN OF ENROLLMENT AND STUDENT SERVICES \(pending Board approval\)|Full Time Faculty for Nursing and Health Professions)$/i.test(title)) return 'reviewed_stale_or_nonfaculty'
  if (/faculty\s*(?:&|and|\/)\s*staff|staff\s*(?:&|and|\/)\s*faculty|faculty\/staff|staff\/faculty/i.test(title)) return 'faculty_staff_page'
  if (/\bfaculty\b/i.test(title) && /\b(?:handbooks?|benefits?|bios?|directory|email|intranet|logins?|portal|resources?|syllabi|vitae|governance|checklist|bookshelf|seminar|moving expenses|rubric|style guide|meetings|awards?|scholarship|plan only|support|success collective)\b/i.test(title)) return 'faculty_resource_page'
  if (/^(?:Administration & Faculty|Advising Assistance Center-Faculty|All Faculty|College Faculty|Application form for Faculty and Administration Positions|Apply for Faculty Positions|Click Here to Apply for All Faculty Positions|Concordia Faculty Application|LCU Faculty Application|NWOSU Application for Faculty|Printable Faculty Application|Requirements for Faculty.*|Banner for Faculty and Advisors|Celebration of Faculty Scholarship|External Applicants Join our team of Faculty and Staff.*|Faculty Resource Guide|Faculty Resource Hub|For Faculty and Staff|For Current Faculty & Staff|Helpful Resources for Faculty and Staff|Navigate for Faculty\/Staff|Navigate our list of resources.*|Our International Faculty|Roadrunner Faculty Success Collective|Services for Faculty|Staff \| College of Osteopathic Medicine\| Faculty \| Graduate Assistants|Stanford Faculty Positions|Purdue Global Faculty|West Lafayette Faculty|Schenectady County Faculty Employment|Traditional Faculty Employment Opportunities|Averett Online Faculty Employment Opportunities|Employment Opportunities :: Category - Faculty|Employment \(Faculty and Staff\).*|See Academic and Faculty Openings|Welcome to .* Faculty Careers site|NMU Faculty Experience|FW Faculty|New Faculty|New Faculty Seminar|New Affiliate Faculty Checklist|High School Staff & Faculty|Leaders, Faculty, Staff & Board|Leadership & Faculty|Meet Our Star Faculty|Find Faculty & Staff|MyState – Faculty|United Faculty of Florida|Graduate Professors|Teaching Fellows|Coe Professors Helping You Discover Your Passion|Two CUNY Law Professors Appointed.*|View this faculty member|Professors at Play.*|Instructors|Students & Faculty)$/i.test(title)) return 'generic_or_profile_page'
  if (/^(?:Non-faculty openings|Current Students, Faculty|Students, Faculty|Student\/Faculty|LOGIN – Students|Logins \(current students|Email - Faculty|Staff & Faculty Email)/i.test(title)) return 'non_posting_page'

  const genericProfilePath = /\/(?:academics|academic-institutes|colleges-departments|departments|libraries|community-programs|faculty-staff|fine-arts-faculty|humanities-faculty|math-science-faculty|faculty|sponsor|equity-and-inclusion)(?:\/|$)/i.test(url)
  const hiringPath = /(?:job|career|employment|opportunit|opening|posting|position|apply|recruit|hiring|human-resources|\/hr\/|faculty-search|\.pdf(?:$|\?))/i.test(url)
  if (genericProfilePath && !hiringPath && /\b(?:faculty|instructors?|professors?)\b/i.test(title)) return 'profile_or_department_page'

  const allowedFellow = /\b(?:CORL Fellow Translational Research|Fellow of Law - Fixed Term|Pro Bono Clinic Fellow|SUNY PRODiG Plus Fellow|Visiting Fellow in the Creative Arts)\b/i.test(title)
  if (/\bfellow\b/i.test(title) && !allowedFellow && !/\bpost[- ]?doc(?:toral)?\b|(?:research and teaching|teaching|research) fellow/i.test(title)) return 'nonfaculty_fellowship'
  if (/^(?:Advising Assistant|Executive Director, Executive Education|Extra Help\/Bowen Fellow - Student Worker|Federal Work-Study|Job Coach & PreEts Instructor, Toledo Transition, Seasonal|Program Manager 2|Student Worker - A&D Faculty Offices)/i.test(title)) return 'nonfaculty_role'
  return null
}

function addReason(reasons, dimensions, code, severity, dimension, deduction, detail) {
  dimensions[dimension] = clamp(dimensions[dimension] - deduction)
  reasons.push({ code, severity, dimension, deduction, detail })
}

export function stableJobId(job) {
  const identity = clean(job?.canonicalJobId) || clean(job?.url) || `${clean(job?.college)}|${clean(job?.title)}`
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)
}

export function scorePost(job, { today = new Date() } = {}) {
  const title = clean(job?.title)
  const rawDescription = clean(job?.description) || clean(job?.summary)
  const challengeDescription = isChallengeDescription(rawDescription)
  // A bot-challenge/security-verification page is not real description
  // content -- treat it as absent everywhere below (issue #130).
  const description = challengeDescription ? '' : rawDescription
  const college = clean(job?.college)
  const location = clean(job?.location)
  const rawDepartment = clean(job?.department)
  const department = cleanDepartment(rawDepartment) || ''
  const url = clean(job?.url)
  const todayIso = dateOnly(today) || new Date().toISOString().slice(0, 10)
  const dimensions = { relevance: 100, attribution: 100, link: 100, freshness: 100, completeness: 100, duplication: 100 }
  const reasons = []
  let hardQuarantine = false
  const reviewedFalsePositive = clean(job?.qualityEvidence) === 'reviewed-non-posting'
    ? reviewedWeakEvidenceFalsePositiveReason(job)
    : null

  if (!title || PLACEHOLDER_TITLE_RE.test(title)) {
    addReason(reasons, dimensions, 'placeholder_title', 'error', 'relevance', 100, 'The title is empty or generic page chrome.')
    hardQuarantine = true
  }

  const hasStrongAcademicTitle = STRONG_ACADEMIC_TITLE_RE.test(title) || hasDeanAppointmentTitle(title)
  const isExplicitAdjunctAppointment = EXPLICIT_ADJUNCT_APPOINTMENT_RE.test(title)
  const hasExplicitFacultyAppointmentQualifier =
    /\b(?:adjunct|clinical|research|teaching|visiting)\s+faculty\b|\bfaculty\s+(?:appointment|position)\b|\bapplicant pool\b/i.test(title)
  const isFacultyStaffResourcePage =
    FACULTY_STAFF_RESOURCE_TITLE_RE.test(title)
    && !hasStrongAcademicTitle
    && !FACULTY_STAFF_APPOINTMENT_OVERRIDE_RE.test(title)
  const isFacultyResourceOrMarketingTitle =
    RESOURCE_TITLE_RE.test(title)
    || NON_POSTING_INFORMATION_TITLE_RE.test(title)
    || NON_POSTING_NEWS_TITLE_RE.test(title)
    || INFORMATIONAL_FACULTY_TITLE_RE.test(title)
    || FACULTY_EMPLOYMENT_LANDING_TITLE_RE.test(title)
    || FACULTY_INFORMATION_PAGE_TITLE_RE.test(title)
    || REVIEWED_FACULTY_INFORMATION_TITLE_RE.test(title)
    || REVIEWED_NON_POSTING_EXACT_TITLES.has(title.toLowerCase())
    || isReviewedInstitutionFacultyDirectory(job)
    || (SEARCH_PAGE_CHROME_TITLE_RE.test(title) && classifyLink(url) === 'search-page')
    || (FACULTY_RESOURCE_KEYWORD_RE.test(title) && !hasStrongAcademicTitle && !isExplicitAdjunctAppointment && !hasExplicitFacultyAppointmentQualifier)
    || APPLICANT_INFORMATION_PAGE_RE.test(title)
    || CAMPUS_VISIT_MARKETING_RE.test(title)
    || isFacultyStaffResourcePage
  if (isFacultyResourceOrMarketingTitle) {
    addReason(reasons, dimensions, 'resource_page_title', 'error', 'relevance', 100, 'The title names a faculty resource, directory, or marketing page rather than an appointment.')
    hardQuarantine = true
  }
  if (TEST_OR_PLACEHOLDER_TITLE_RE.test(title)) {
    addReason(reasons, dimensions, 'test_or_placeholder_posting', 'error', 'relevance', 100, 'The title indicates a test record or explicitly instructs applicants not to apply.')
    hardQuarantine = true
  }
  if (CLEAR_NON_APPOINTMENT_TITLE_RE.test(title)) {
    addReason(reasons, dimensions, 'nonacademic_staff_title', 'error', 'relevance', 100, 'The title is an administrative, student-services, or recreation role rather than a faculty appointment.')
    hardQuarantine = true
  }
  if (isFilledComplianceNotice(title, description)) {
    addReason(reasons, dimensions, 'filled_compliance_notice', 'error', 'relevance', 100, 'The posting is a mandatory Department of Labor compliance notice for a position that has already been filled.')
    hardQuarantine = true
  }
  if (reviewedFalsePositive) {
    addReason(reasons, dimensions, 'reviewed_non_posting', 'error', 'relevance', 100, `Reviewed as ${reviewedFalsePositive.replaceAll('_', ' ')}.`)
    hardQuarantine = true
  }
  // Some ApplicantStack pages concatenate labeled metadata without spaces
  // (for example, "Type:Full-Time StaffLocation:..."). The source's own job
  // type is stronger than an ambiguous title such as "Instructor" or "Dean":
  // these are staff searches, not faculty appointments.
  if (/Type:\s*Full-Time Staff(?=Location\b)/i.test(description)) {
    addReason(reasons, dimensions, 'source_labeled_staff_role', 'error', 'relevance', 100, 'The source labels this opening as full-time staff rather than faculty.')
    hardQuarantine = true
  }

  const startsWithAppointment = /^(?:adjunct\b|associate\s+faculty\b|faculty\b)/i.test(title) && !/^(?:faculty affairs|faculty support|faculty development|faculty resources?)\b/i.test(title)
  const contextualFacultyAppointment =
    /\bfaculty\b/i.test(title)
    && APPOINTMENT_CONTEXT_RE.test(title)
    && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const coordinatedFacultyAppointment =
    /\bfaculty\b/i.test(title)
    && /\bprogram coordinator\b|\bcoordinator\s*\/\s*faculty\b|\bfaculty\s*(?:\/|&)\s*(?:program\s+)?coordinator\b/i.test(title)
    && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const namedChairAppointment = /\b(?:distinguished|endowed|named)\b.*\bchairs?\b/i.test(title)
  const facultySpecialistAppointment = /\b(?:senior\s+)?faculty specialist\b/i.test(title) && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const adjunctAppointment = /\badjunct\b/i.test(title) && !/\badjunct\s+faculty\s+recruit(?:er|ing|ment)\b/i.test(title)
  const descriptionBackedFacultyAppointment =
    /\bfaculty\b/i.test(title)
    && /\b(?:classroom|courses?|curriculum|educat(?:e|ion)|instruct(?:ion|or)|students?|teach(?:er|es|ing)?)\b/i.test(description)
    && !NON_APPOINTMENT_FACULTY_CONTEXT_RE.test(title)
  const reviewedAcademicAppointment = clean(job?.qualityEvidence) === 'reviewed-academic-appointment'
  const hasAcademicAppointmentTitle = hasStrongAcademicTitle || startsWithAppointment || contextualFacultyAppointment || coordinatedFacultyAppointment || namedChairAppointment || facultySpecialistAppointment || adjunctAppointment || descriptionBackedFacultyAppointment || reviewedAcademicAppointment
  const explicitStudentRole = /\b(?:student fellow|fellow\s*\(student\))(?:\b|$)/i.test(title)
  if (STAFF_ROLE_RE.test(title) && !hasAcademicAppointmentTitle) {
    addReason(reasons, dimensions, 'administrative_staff_title', 'error', 'relevance', 90, 'Administrative or support role lacks an academic appointment title.')
    hardQuarantine = true
  } else if ((CLEAR_NONACADEMIC_RE.test(title) && !hasAcademicAppointmentTitle) || RECREATIONAL_INSTRUCTOR_RE.test(title) || REVIEWED_NONACADEMIC_TITLE_RE.test(title)) {
    addReason(reasons, dimensions, 'nonacademic_staff_title', 'error', 'relevance', 100, 'Clearly nonacademic staff role.')
    hardQuarantine = true
  } else if (STUDENT_RESOURCE_RE.test(title) && (!hasAcademicAppointmentTitle || explicitStudentRole)) {
    addReason(reasons, dimensions, 'student_service_title', 'error', 'relevance', 90, 'Student-facing service role lacks an academic appointment title.')
    hardQuarantine = true
  } else {
    // "Other" is the classifier's catch-all for "did not fit any real
    // category" -- it carries no positive signal about the role, so it must
    // not suppress the weak-evidence check the way a real positionType
    // (e.g. "Lecturer", "Adjunct") does. This is the same convention already
    // used elsewhere in this codebase (see generate-job-pages.js,
    // generate-rss.js, generate-hub-pages.js: `!job.positionType ||
    // job.positionType === "Other"`). Before this fix, 67 of the 126
    // `academicAppointment=false` records that passed quality did so purely
    // because `positionType: "Other"` was treated as if it were positive
    // metadata (issue #129).
    const positionTypeValue = clean(job?.positionType)
    const hasPositionTypeEvidence = Boolean(positionTypeValue) && positionTypeValue !== 'Other'
    if (!hasAcademicAppointmentTitle && !hasPositionTypeEvidence && !clean(job?.tenureTrack)) {
      addReason(reasons, dimensions, 'weak_academic_evidence', 'warning', 'relevance', 30, 'No strong academic appointment signal appears in the title or normalized metadata.')
    }
  }

  const reviewedLinkEvidence = ['verified-inline-posting', 'verified-filtered-board', 'verified-application-form'].includes(clean(job?.qualityLinkEvidence))
  const linkType = reviewedLinkEvidence ? 'reviewed-direct' : classifyLink(url)
  if (linkType === 'invalid') {
    addReason(reasons, dimensions, 'invalid_url', 'error', 'link', 100, 'URL is missing or invalid.')
    hardQuarantine = true
  } else if (linkType === 'resource-page') {
    addReason(reasons, dimensions, 'resource_page_url', 'error', 'link', 90, 'URL points to a resource or directory page.')
    hardQuarantine = true
  } else if (linkType === 'search-page') {
    addReason(reasons, dimensions, 'search_page_url', 'warning', 'link', 45, 'URL appears to be a search or careers landing page rather than a stable posting.')
  }
  if (url && !/^https:\/\//i.test(url)) addReason(reasons, dimensions, 'non_https_url', 'warning', 'link', 20, 'URL is not HTTPS.')

  if (!college) {
    addReason(reasons, dimensions, 'missing_institution', 'error', 'attribution', 100, 'Institution is missing.')
    hardQuarantine = true
  }
  const conflict = institutionConflict(title, college)
  if (conflict) {
    addReason(reasons, dimensions, 'institution_title_conflict', 'error', 'attribution', 100, `Title names ${conflict}, but the listing is attributed to ${college}.`)
    hardQuarantine = true
  }

  const closeDate = dateOnly(job?.closeDate)
  const postedDate = dateOnly(job?.datePosted)
  if (closeDate && isExpiredPastGrace(job, { today, graceDays: 7 })) {
    addReason(reasons, dimensions, 'expired_posting', 'error', 'freshness', 100, `Deadline ${closeDate} has passed.`)
    hardQuarantine = true
  }
  if (postedDate && postedDate > todayIso) addReason(reasons, dimensions, 'future_posting_date', 'warning', 'freshness', 60, `Posting date ${postedDate} is in the future.`)
  if (!postedDate && !dateOnly(job?.firstSeen)) addReason(reasons, dimensions, 'missing_observation_date', 'info', 'freshness', 15, 'No source posting or first-seen date is available.')

  // A decade-old posting shouldn't get the same freshness confidence as a
  // newly advertised vacancy just because its page is still reachable and no
  // deadline has passed -- unless it carries an explicit evergreen/pool
  // signal, in which case age is expected and shouldn't be penalized at all
  // (issue #131).
  const evergreenPool = hasEvergreenPoolSignal(title, description)
  if (postedDate && postedDate <= todayIso && !evergreenPool) {
    const ageYears = (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${postedDate}T00:00:00Z`)) / MS_PER_YEAR
    const tier = AGE_FRESHNESS_TIERS.find((candidate) => ageYears >= candidate.years)
    if (tier) {
      addReason(reasons, dimensions, tier.code, tier.severity, 'freshness', tier.deduction, `Posting date ${postedDate} is more than ${tier.years} year(s) old with no evergreen/applicant-pool signal.`)
    }
  }

  if (!description) {
    if (challengeDescription) {
      addReason(reasons, dimensions, 'bot_challenge_description', 'warning', 'completeness', 35, 'Description content is a bot-challenge/security-verification page, not real job content.')
    } else {
      addReason(reasons, dimensions, 'missing_description', 'info', 'completeness', 35, 'Description is missing.')
    }
  } else if (description.length < 80) {
    addReason(reasons, dimensions, 'thin_description', 'info', 'completeness', 20, 'Description is unusually short.')
  }
  if (!department) addReason(reasons, dimensions, 'missing_department', 'info', 'completeness', 10, 'Department is missing or does not look like a valid department name.')
  if (!location && !clean(job?.state)) addReason(reasons, dimensions, 'missing_location', 'info', 'completeness', 15, 'Location is missing.')
  else if (isPlaceholderLocation(location, job?.college)) addReason(reasons, dimensions, 'placeholder_location', 'info', 'completeness', 15, 'Location is just the institution name, not a real city.')
  if (!closeDate && !job?.openUntilFilled) addReason(reasons, dimensions, 'missing_deadline', 'info', 'completeness', 5, 'Deadline is not provided.')

  const duplicateCount = Number(job?.duplicateCount || 1)
  if (duplicateCount > 1) addReason(reasons, dimensions, 'grouped_duplicates', 'info', 'duplication', Math.min(30, (duplicateCount - 1) * 5), `${duplicateCount} source records are grouped.`)

  const weights = { relevance: 0.35, attribution: 0.2, link: 0.2, freshness: 0.1, completeness: 0.1, duplication: 0.05 }
  const score = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + dimensions[key] * weight, 0))
  const hasError = reasons.some((reason) => reason.severity === 'error')
  const hasWarning = reasons.some((reason) => reason.severity === 'warning')
  const status = hardQuarantine || score < 50 ? 'quarantine' : (hasError || hasWarning || score < 80 ? 'review' : 'pass')

  return {
    id: stableJobId(job),
    score,
    status,
    dimensions,
    reasons,
    linkType,
    academicAppointment: hasAcademicAppointmentTitle,
    evergreenPool,
  }
}

// Conservative publishing gate: only these combinations are precise enough to
// remove without manual review. Other errors remain visible in the review report.
export function confirmedNonFacultyReason(job, options = {}) {
  const quality = scorePost(job, options)
  const codes = new Set(quality.reasons.map((reason) => reason.code))
  if (codes.has('resource_page_title')) return 'resource_page_title'
  if (codes.has('test_or_placeholder_posting')) return 'test_or_placeholder_posting'
  if (codes.has('filled_compliance_notice')) return 'filled_compliance_notice'
  if (codes.has('administrative_staff_title')) return 'administrative_staff_title'
  if (codes.has('nonacademic_staff_title')) return 'nonacademic_staff_title'
  if (codes.has('student_service_title')) return 'student_service_title'
  if (codes.has('source_labeled_staff_role')) return 'source_labeled_staff_role'
  if (codes.has('resource_page_url') && !quality.academicAppointment) return 'resource_page_url'
  return null
}

export function scoreCatalog(jobs, options = {}) {
  return (Array.isArray(jobs) ? jobs : []).map((job) => ({ job, quality: scorePost(job, options) }))
}

export function deterministicStratifiedSample(scoredRows, { size = 200 } = {}) {
  const rows = Array.isArray(scoredRows) ? scoredRows : []
  const buckets = new Map()
  for (const row of rows) {
    const key = `${clean(row?.job?.source) || 'Unknown'}|${row?.quality?.status || 'unknown'}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => a.quality.id.localeCompare(b.quality.id))

  const selected = []
  const orderedBuckets = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
  let cursor = 0
  while (selected.length < size && orderedBuckets.some(([, bucket]) => bucket.length > 0)) {
    const [, bucket] = orderedBuckets[cursor % orderedBuckets.length]
    if (bucket.length) selected.push(bucket.shift())
    cursor += 1
  }
  return selected
}

export function summarizeHumanLabels(labels) {
  const rows = Array.isArray(labels) ? labels.filter((row) => ['valid', 'invalid'].includes(row?.label)) : []
  const valid = rows.filter((row) => row.label === 'valid').length
  const invalid = rows.length - valid
  return {
    reviewed: rows.length,
    valid,
    invalid,
    precisionPct: rows.length ? Number(((valid / rows.length) * 100).toFixed(2)) : null,
  }
}
