export const OPTION_COUNT: number = 4
export const MAX_QUESTIONS_PER_TEAM: number = 50
export const MAX_SECONDS_PER_QUESTION: number = 600
export const OPTION_LABELS: readonly string[] = ['A', 'B', 'C', 'D']
// validateContest.ts is copied unchanged from Quizrush and reserves this slug, so decks stay interchangeable.
export const CONTESTS_DIR: string = 'contests'
export const STAGES_DIR: string = 'stages'
export const GAME_SETTINGS_FILE: string = 'game.json'
export const MAX_LEVELS: number = 50

// Must match the Go API (roster.MaxNameLength, roster.MaxEmojiLength and game.MaxStudentsPerClassroom).
export const MAX_NAME_LENGTH: number = 60
export const MAX_EMOJI_LENGTH: number = 16
export const MAX_STUDENTS: number = 200
// Must match the backend's MAX_PHOTO_BYTES default; the server enforces its own setting.
export const MAX_PHOTO_BYTES: number = 3 * 1024 * 1024
// Must match the backend's MAX_ROSTER_BYTES default; the Google Sheet backend reads the workbook in the browser.
export const MAX_ROSTER_BYTES: number = 2 * 1024 * 1024
export const MAX_CLASSROOM_NAME_LENGTH: number = 80
// Must match the Go API (auth.ValidPIN).
export const MIN_PIN_LENGTH: number = 6
export const MAX_DESCRIPTION_LENGTH: number = 500

export const ROSTER_PREVIEW_ROWS: number = 8
export const PAWNS_PER_CLUSTER: number = 12
export const PICK_ANIMATION_MS: number = 1600
export const PICK_STEP_MS: number = 120
export const STAR_ANIMATION_MS: number = 1400
