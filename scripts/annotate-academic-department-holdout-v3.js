#!/usr/bin/env node
// Source labels are recorded before the candidate is run against v3.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const file = path.join(root, 'generated/academic-department-holdout-v3.json')
const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
if (rows.some((row) => row.departmentReviewStatus !== 'unreviewed')) throw new Error('V3 labels are already frozen')
const payload = JSON.parse(fs.readFileSync(path.join(root, 'public/jobs.json'), 'utf8'))
const jobs = new Map((Array.isArray(payload) ? payload : payload.jobs).map((job) => [job.canonicalJobId || job.url, job]))
const labels = new Map([
  [1, ['HSC-Physician Assistant Studies', 'Department: HSC-Physician Assistant Studies-300840']],
  [2, ['School of Science & Mathematics', 'Department School of Science & Mathematics Opening Date']],
  [5, ['Library', 'Department Library Opening Date']],
  [6, ['Division of Business and Technologies', 'leads the Division of Business and Technologies']],
  [7, ['Department of Microbiology', 'Department of Microbiology invites applications']],
  [10, ['Department of Kinesiology', 'Department of Kinesiology invites applications']],
  [11, ['Department of Art', 'Department of Art invites applications']],
  [12, ['School of Business', 'The School of Business invites applications']],
  [13, ['Division of Liberal Arts', 'Division of Liberal Arts']],
  [17, ['Division of General Education and Interdisciplinary Studies', 'Division of General Education and Interdisciplinary Studies']],
  [21, ['MSU English Department', 'The MSU English Department maintains a pool']],
  [23, ['College of Osteopathic Medicine', 'College of Osteopathic Medicine (HCOM) at Ohio University']],
  [24, ['Department of Public Health', 'Department of Public Health is seeking to hire adjunct faculty']],
  [26, ['Business', 'Department: Business Reports to:']],
  [27, ['Department of Humanity & Society', 'Department of Humanity & Society has an ongoing need']],
  [29, ['Department of Psychology', 'The Department of Psychology at The Pennsylvania State University']],
  [31, ['Department of English', 'Department of English invites applications']],
  [32, ['School of Professional Nursing Practice', 'Division School of Professional Nursing Practice Position Type']],
  [36, ['School of Engineering', 'School of Engineering has over 1,800 students']],
  [37, ['Department of Mathematics', 'The Department of Mathematics at Virginia Tech']],
  [38, ['Daniels College of Business', 'Division: Daniels College of Business']],
  [39, ['Department of Neurology', 'Department of Neurology is seeking motivated applicants']],
  [40, ['School of Education', 'The School of Education oversees the university’s educator preparation program']],
  [42, ['Chemistry', 'Department Chemistry Opening Date']],
  [43, ['Pharmacy | Practice and Science', 'Department: Pharmacy | Practice and Science']],
  [45, ['Operations and Decision Technologies Department', 'The Operations and Decision Technologies Department of the Kelley School of Business']],
  [47, ['School of Health Administration', 'Department/School School of Health Administration']],
  [49, ['Department of Child Development, Literacy, and Special Education', 'Department of Child Development, Literacy, and Special Education']],
  [50, ['Department of World Languages and Literatures', 'Department of World Languages and Literatures Position Description']],
  [51, ['Department of Physical Medicine and Rehabilitation', 'Department of Physical Medicine and Rehabilitation at UC Davis']],
  [54, ['College of Social Work', 'programs housed in the College of Social Work']],
  [55, ['Department of Economics & Real Estate', 'Department of Economics & Real Estate in the Lee Business School']],
  [56, ['School of Law', 'School of Law is seeking an Assistant/Associate/Full Professor']],
  [57, ['Dept of Physical Therapy Education', 'Dept of Physical Therapy Education Job Summary']],
  [58, ['Department of Communication and Media', 'The Department of Communication and Media invites applicants']],
  [59, ['Department of Content Area Teacher Education', 'Department of Content Area Teacher Education']],
  [62, ['Department of Communication Sciences and Disorders', 'Department of Communication Sciences and Disorders (CSD)']],
  [63, ['Division of Hematology, Blood & Marrow Transplantation and Cellular Therapy Program', 'Division of Hematology, Blood & Marrow Transplantation and Cellular Therapy Program']],
  [65, ['Department of Biological Sciences', 'Department of Biological Sciences at Ohio Wesleyan University']],
  [67, ['Occupational Therapy Program', 'Adjunct Lab Instructor – Occupational Therapy Program in the Division of Health Sciences']],
  [69, ['Department of Nephrology', 'join our Department of Nephrology']],
  [71, ['Mervyn M. Dymally College of Nursing', 'Mervyn M. Dymally College of Nursing Now accepting applications']],
  [74, ['Division of Pulmonary & Critical Care', 'The Division of Pulmonary & Critical Care at the Medical College of Wisconsin']],
  [77, ['Department of Special Education', 'The Department of Special Education invites a pool']],
  [78, ['Department of Business and Management', 'Department of Business and Management seeks applications']],
  [79, ['Department of Modern Languages and Literatures', 'Department of Modern Languages and Literatures maintains an applicant pool']],
  [80, ['Health Sciences', 'Department: Health Sciences Job Summary']],
])
const noNamedUnit = new Map([
  [18, 'Complete posting contains licensing requirements and institutional text, but no hiring unit.'],
  [41, 'Complete posting names a course and the institution, but no hiring unit.'],
  [76, 'Complete posting names a teaching subject, but no hiring unit.'],
])
for (const [number, [goldDepartment, quote]] of labels) {
  const row = rows[number - 1]
  const job = jobs.get(row.id)
  const source = `${row.title} ${job?.description || ''}`.replace(/\s+/g, ' ')
  if (!source.toLowerCase().includes(quote.toLowerCase())) throw new Error(`Evidence missing for row ${number}: ${quote}`)
  row.goldDepartment = goldDepartment
  row.departmentEvidence = quote
  row.departmentReviewStatus = 'reviewed'
}
for (const [number, note] of noNamedUnit) {
  const row = rows[number - 1]
  const description = String(jobs.get(row.id)?.description || '')
  if (description.length < 2500 || description.length >= 4000) throw new Error(`Cannot verify complete source for row ${number}`)
  row.departmentReviewStatus = 'reviewed'
  row.departmentReviewNote = note
}
fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`)
console.log(`Froze ${labels.size} named-unit and ${noNamedUnit.size} no-unit labels before scoring v3`)
