/**
 * @OnlyCurrentDoc
 */

// Read-only: the teacher's browser writes the sheet through the Sheets API; this answers the student link only.
const TABLES = {
  classrooms: ['slug', 'name', 'current_stage_slug', 'created_at'],
  students: ['id', 'classroom_slug', 'name', 'emoji', 'position', 'created_at'],
  turns: ['classroom_slug', 'stage_slug', 'session_id', 'student_id', 'question_id', 'status', 'created_at'],
}

const MAX_CLASSROOM_SLUG_LENGTH = 90
const STATUS_CORRECT = 'correct'
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

class AppError_ extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function doGet(e) {
  return respond_(() => {
    const params = (e && e.parameter) || {}
    if (params.action !== 'public') {
      throw new AppError_(404, 'unknown_action', 'This request is not supported.')
    }
    return publicClassroom_(params.slug)
  })
}

// Web apps always answer 200, so the HTTP status the Go API would send travels in the body.
function respond_(handler) {
  let body
  try {
    body = { data: handler() }
  } catch (error) {
    if (error instanceof AppError_) {
      body = { error: { status: error.status, code: error.code, message: error.message } }
    } else {
      console.error('request failed', error && error.stack ? error.stack : String(error))
      body = { error: { status: 500, code: 'internal_error', message: 'Something went wrong. Please try again.' } }
    }
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON)
}

// Everything a share-link visitor may see: no used question ids, no session, no other classrooms.
function publicClassroom_(classroomSlug) {
  const notFound = () => new AppError_(404, 'classroom_not_found', "This classroom link doesn't work. Ask your teacher for the current link.")
  if (typeof classroomSlug !== 'string' || classroomSlug.length > MAX_CLASSROOM_SLUG_LENGTH || !SLUG_PATTERN.test(classroomSlug)) {
    throw notFound()
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  const classroom = readRows_(spreadsheet, 'classrooms').find((row) => row.slug === classroomSlug)
  if (classroom === undefined) {
    throw notFound()
  }
  const turns = readRows_(spreadsheet, 'turns')
    .filter((turn) => turn.classroom_slug === classroomSlug)
    .sort((a, b) => compareText_(a.stage_slug, b.stage_slug) || compareText_(a.question_id, b.question_id))
  const points = {}
  turns.forEach((turn) => {
    if (turn.status === STATUS_CORRECT) {
      points[turn.student_id] = (points[turn.student_id] || 0) + 1
    }
  })
  const students = readRows_(spreadsheet, 'students')
    .filter((student) => student.classroom_slug === classroomSlug)
    .sort((a, b) => Number(a.position) - Number(b.position) || compareText_(a.created_at, b.created_at))
    .map((student) => ({
      id: student.id,
      name: student.name,
      emoji: student.emoji,
      photoFile: null,
      position: Number(student.position),
      points: points[student.id] || 0,
    }))
  return {
    name: classroom.name,
    currentStageSlug: classroom.current_stage_slug === '' ? null : classroom.current_stage_slug,
    students,
    results: turns.map((turn) => ({ studentId: turn.student_id, stageSlug: turn.stage_slug, outcome: turn.status })),
  }
}

// Rows are matched to columns by position, so a reordered or renamed header row is refused rather than misread.
function readRows_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name)
  if (sheet === null) {
    return []
  }
  const columns = TABLES[name]
  const values = sheet.getDataRange().getValues()
  const header = (values[0] || []).slice(0, columns.length).map(cellText_)
  if (values.length > 0 && header.join(',') !== columns.join(',')) {
    console.error('sheet header changed', JSON.stringify({ sheet: name, header }))
    throw new AppError_(500, 'sheet_header_changed', 'The "' + name + '" tab\'s first row must be: ' + columns.join(', ') + '.')
  }
  const rows = []
  values.slice(1).forEach((cells) => {
    const row = {}
    columns.forEach((column, columnIndex) => {
      row[column] = cellText_(cells[columnIndex])
    })
    if (columns.some((column) => row[column] !== '')) {
      rows.push(row)
    }
  })
  return rows
}

function cellText_(value) {
  if (value === null || value === undefined) {
    return ''
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return String(value)
}

function compareText_(a, b) {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}
