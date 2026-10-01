#!/usr/bin/env node
// Source labels were selected from the posting text and title before any
// predictions for this holdout were generated or scored.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const destination = path.join(root, 'generated/academic-department-holdout-v2.json')
const rows = JSON.parse(fs.readFileSync(destination, 'utf8'))
if (rows.some((row) => row.departmentReviewStatus === 'reviewed')) throw new Error('Holdout labels are already frozen')
const payload = JSON.parse(fs.readFileSync(path.join(root, 'public/jobs.json'), 'utf8'))
const jobs = new Map((Array.isArray(payload) ? payload : payload.jobs).map((job) => [job.canonicalJobId || job.url, job]))
const labels = new Map([
  [1, ['Graduate Education, Leadership and Counseling', 'Department Graduate Education, Leadership and Counseling']],
  [2, ['School of Health Professions', 'School of Health Professions']],
  [4, ['Department of Obstetrics and Gynecology', 'Department of Obstetrics and Gynecology']],
  [5, ['Department of Finance and Quantitative Methods', 'Department of Finance and Quantitative Methods']],
  [6, ['School of Nursing and Health Professions', 'School of Nursing and Health Professions']],
  [7, ['College of Healthcare & Behavioral Sciences', 'College of Healthcare & Behavioral Sciences']],
  [9, ['CASE - Humanities (English, MC, History)', 'Department CASE - Humanities (English, MC, History)']],
  [11, ['Department of Theatre', 'Department of Theatre at Abilene Christian University']],
  [12, ['First-Year Experience and College Success', 'Department First-Year Experience and College Success']],
  [13, ['School of Communication & Public Affairs', 'School of Communication & Public Affairs']],
  [15, ['Ctr for Transl Biomed Research', 'Department Ctr for Transl Biomed Research']],
  [17, ['Department of Psychology', 'Department of Psychology at The Pennsylvania State University']],
  [22, ['Department of Culture, Arts and Communication', 'Department of Culture, Arts, and Communication']],
  [24, ['School of Law', 'School of Law is seeking candidates']],
  [25, ['Mass Communication', 'Department Mass Communication Opening Date']],
  [28, ['Department of Biology', 'Department of Biology at California State University']],
  [30, ['Division of Physician Assistant Studies', 'Division of Physician Assistant Studies']],
  [32, ['Physics', 'Department Physics Opening Date']],
  [33, ['Department of Elementary and Bilingual Education', 'Department of Elementary and Bilingual Education at California State University']],
  [35, ['Sch of Ed, Behavioral & Soc Science', 'Department Sch of Ed, Behavioral & Soc Science']],
  [43, ['Department of Biomedical Sciences', 'Department of Biomedical Sciences at Mercer University']],
  [44, ['Division of Cardiothoracic Surgery', 'Division of Cardiothoracic Surgery']],
  [45, ['Department of History', 'Department of History']],
  [49, ['Management, Marketing And General Business', 'Department Management, Marketing And General Business']],
  [50, ['Division of Generalists', 'Division of Generalists, Department of Obstetrics and Gynecology']],
  [52, ['Department of Radiation Oncology', 'Department of Radiation Oncology at the University of Miami']],
  [53, ['Applied Technology Department', 'Applied Technology Department']],
  [54, ['Economics Department', 'The Economics Department of the Earl N. Phillips School of Business']],
  [55, ['Department of Management', 'Department: Department of Management']],
  [56, ['Department of Health, Human Performance & Recreation', 'Department of Health, Human Performance & Recreation']],
  [57, ['Math, Science & Health Professionals', 'Department Math, Science & Health Professionals']],
  [60, ['Department of Political Science and International Studies', 'Department of Political Science and International Studies']],
  [62, ['Department of Mechanical Engineering', 'Department of Mechanical Engineering']],
  [63, ['Division of Social Sciences', 'Division of Social Sciences seeks to hire']],
  [64, ['Philosophy Department', 'The Philosophy Department invites applications']],
  [67, ['Liberal Studies', 'Department Liberal Studies Posting Detail']],
  [68, ['Department of Primary Care', 'Department of Primary Care']],
  [69, ['Department of Psychiatric Rehabilitation and Counseling Professions', 'Department of Psychiatric Rehabilitation and Counseling Professions']],
  [70, ['Department of Health, Human Performance & Recreation', 'Department of Health, Human Performance & Recreation']],
  [72, ['Dental Hygiene', 'Department Dental Hygiene Opening Date']],
  [77, ['School of Science, Technology, Engineering, and Mathematics', 'School of Science, Technology, Engineering, and Mathematics']],
  [79, ['Department of Psychology', 'Department of Psychology at Bryn Mawr College']],
  [81, ['Marketing Department', 'The Marketing Department']],
  [85, ['Dept of Physician Assistants', 'Department Dept of Physician Assistants']],
  [87, ['Nursing', 'Department Nursing Open Date']],
  [88, ['Tuck School of Business', 'Tuck School of Business at Dartmouth']],
  [89, ['Computer Science', 'Department: Computer Science Work Location']],
  [90, ['Child and Family Health Sciences Department', 'Child and Family Health Sciences Department']],
  [91, ['Division of Primary Care Sports Medicine', 'Division of Primary Care Sports Medicine']],
  [93, ['Department of Protective and Human Studies', 'Department of Protective and Human Studies']],
  [96, ['Family Science', 'Department Family Science Opening Date']],
  [99, ['Department of Comparative Pathobiology', 'Department of Comparative Pathobiology']],
  [100, ['School of Nursing', 'School of Nursing']],
])

for (const [number, [goldDepartment, quote]] of labels) {
  const row = rows[number - 1]
  const job = jobs.get(row.id)
  if (!job) throw new Error(`Missing saved job for row ${number}`)
  const source = `${row.title} ${job.description || ''}`.replace(/\s+/g, ' ')
  if (!source.toLowerCase().includes(quote.toLowerCase())) throw new Error(`Evidence missing for row ${number}: ${quote}`)
  row.goldDepartment = goldDepartment
  row.departmentEvidence = quote
  row.departmentReviewStatus = 'reviewed'
}
fs.writeFileSync(destination, `${JSON.stringify(rows, null, 2)}\n`)
console.log(`Froze ${labels.size} source-supported department labels in ${rows.length} listings`)
