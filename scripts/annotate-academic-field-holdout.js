#!/usr/bin/env node
// Frozen, source-supported department labels for the independent holdout.
// Each quote must occur in the saved title or posting text.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const file = path.join(root, 'generated/academic-field-holdout.json')
const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/jobs.json'), 'utf8'))
const jobs = new Map((Array.isArray(data) ? data : data.jobs).map((job) => [job.canonicalJobId || job.url, job]))
const labels = new Map([
  [1, ['Civil Engineering Technology', 'Department: Civil Engineering Technology']],
  [2, ['Division of General Internal Medicine', 'Division of General Internal Medicine within the Department of Medicine']],
  [3, ['Department of Psychology', 'Department of Psychology at Winthrop University']],
  [5, ['CNHHS - Nursing', 'Department CNHHS - Nursing']],
  [9, ['Department of Exercise Physiology', 'Department of Exercise Physiology seeks applicants']],
  [10, ['Humanities', 'Division Humanities Opening Date']],
  [11, ['School of Social Work', 'School of Social Work New Mexico State University']],
  [12, ['Department of Library and Information Science', 'Department of Library and Information Science']],
  [13, ['Heilbrunn Department of Population and Family Health', 'Heilbrunn Department of Population and Family Health']],
  [14, ['VVSTC - Electrical', 'Department VVSTC - Electrical']],
  [18, ['Division of Workforce and Economic Development', 'Division of Workforce and Economic Development']],
  [19, ['Kinesiology', 'Department: Kinesiology']],
  [20, ['Business Administration', 'Department Business Administration Opening Date']],
  [21, ['Division of Hematology and Oncology', 'Division of Hematology and Oncology']],
  [22, ['Department of Biological Sciences', 'Department of Biological Sciences at Old Dominion']],
  [23, ['Department of Child and Family Studies', 'Department of Child and Family Studies (CFS)']],
  [24, ['Department of Medical Sciences', 'Department of Medical Sciences at the University of Wisconsin']],
  [25, ['Department of Professional and Distance Education', 'Department of Professional and Distance Education']],
  [26, ['Education and Leadership', 'Department Education and Leadership Opening Date']],
  [29, ['School of Management', 'School of Management The University of Southern Mississippi']],
  [30, ['School of Respiratory Care', 'School of Respiratory Care within the College of Health Sciences']],
  [33, ['College of Education', 'College College of Education Position Title']],
  [35, ['CON | Baccalaureate Education', 'CON | Baccalaureate Education']],
  [37, ['Architecture, IDE and Manufacturing', 'Department Architecture, IDE and Manufacturing']],
  [38, ['Department of Psychology and Counseling', 'Department of Psychology and Counseling at Georgian Court']],
  [39, ['Department of Economics', 'Department of Economics is seeking']],
  [40, ['Division of Surgical Oncology', 'Division of Surgical Oncology']],
  [41, ['PCC Fine Arts, Humanities, & Mass Communication', 'Department: PCC Fine Arts, Humanities, & Mass Communication']],
  [44, ['Department of Psychology', 'Department of Psychology is a research-oriented']],
  [49, ['SPIA-International Affairs', 'Department SPIA-International Affairs']],
  [50, ['Department of Neurology', 'Department of Neurology']],
  [54, ['Geography', 'Department Geography About The Position']],
  [57, ['Department of Pharmaceutical Sciences', 'Department of Pharmaceutical Sciences of the University of North Texas']],
  [58, ['School of Nursing', 'School of Nursing Department School of Nursing']],
  [60, ['Upward Bound Math/Science', 'Department: Upward Bound Math/Science']],
  [61, ['College of Liberal Arts and Sciences', 'College of Liberal Arts and Sciences Department']],
  [62, ['Department of Management', 'Department of Management at the Zicklin School of Business']],
  [63, ['COLLEGE OF VETERINARY MEDICINE (STW)', 'COLLEGE OF VETERINARY MEDICINE (STW)']],
  [65, ['Department of Mathematics', 'Department of Mathematics (Mathematics Faculty)']],
  [69, ['Aerospace Engineering Department', 'Aerospace Engineering Department in the College of Engineering']],
  [70, ['School of Community Health & Policy', 'Department School of Community Health & Policy']],
  [71, ['Department of Physical Medicine & Rehabilitation', 'Department of Physical Medicine & Rehabilitation']],
  [74, ['Social Sciences Division', 'Department: Social Sciences Division']],
  [76, ['Faculty of Arts and Sciences', 'School Faculty of Arts and Sciences']],
  [77, ['School of Professional Studies', 'School of Professional Studies at the University of Kansas']],
  [78, ['Department of English', 'Department of English at Bates College']],
  [81, ['School of Business', 'School of Business at both the undergraduate']],
  [82, ['Restorative Dental Laboratory Technology Program', 'Department Restorative Dental Laboratory Technology Program']],
  [83, ['Physics, Engineering', 'Department Physics, Engineering']],
  [87, ['Department of Finance', 'Department of Finance at Santa Clara University']],
  [88, ['Department of Psychology', 'Department of Psychology includes nine tenure-track faculty']],
  [89, ['Arts & Sciences Dept', 'Department Arts & Sciences Dept']],
  [90, ['College and Career Readiness', 'College and Career Readiness department at RCCC']],
  [91, ['Department of History, Geography and GIS', 'Department of History, Geography and GIS']],
  [92, ['Workforce Development and Lifelong Learning', 'Department:Workforce Development and Lifelong Learning']],
  [96, ['Geography', 'Department Geography Opening Date']],
  [97, ['Department of Political Science', 'Department of Political Science University of Kentucky']],
  [99, ['Department of History', 'Department of History at Brandeis University']],
  [100, ['Nursing', 'Department Nursing Mission & Vision Statement']],
])

for (const [number, [goldDepartment, quote]] of labels) {
  const row = rows[number - 1]
  const job = jobs.get(row.id)
  if (!job) throw new Error(`Missing saved posting for holdout row ${number}`)
  const source = `${row.title} ${job.description || ''}`.replace(/\s+/g, ' ')
  if (!source.toLowerCase().includes(quote.toLowerCase())) throw new Error(`Evidence quote missing for holdout row ${number}: ${quote}`)
  row.goldDepartment = goldDepartment
  row.departmentEvidence = quote
  row.departmentReviewStatus = 'reviewed'
  row.reviewStatus = 'reviewed'
}
fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`)
console.log(`Froze ${labels.size} source-supported department labels in ${rows.length} holdout listings`)
